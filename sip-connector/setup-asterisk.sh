#!/usr/bin/env bash
# ============================================================================
# KES CRM — установка Asterisk 22 для WebRTC-софтфона («звонки в браузере»)
# через SIP-trunk Binotel. Запускать ОДИН РАЗ на чистой Ubuntu 22.04 VM
# с прямым публичным IP (GCP e2-micro Always Free и т.п.).
#
# Что делает:
#   1) ставит зависимости + собирает Asterisk 22 LTS из исходников
#   2) Let's Encrypt сертификат на <ip>.nip.io (для WSS)
#   3) отдельный self-signed сертификат для DTLS-SRTP (WebRTC)
#   4) pjsip: WSS-транспорт :8089 + endpoint 100 (браузер) + trunk Binotel
#   5) диалплан: исходящие → Binotel, входящие → endpoint 100
#   6) systemd-сервис, UFW, печатает SIP_DOMAIN и SIP_ENDPOINT_PASSWORD
#
# Запуск:
#   chmod +x setup-asterisk.sh
#   sudo BINOTEL_USERNAME=xxxx \
#        BINOTEL_PASSWORD=yyyy \
#        BINOTEL_SERVER=sip52.binotel.com \
#        LE_EMAIL=you@example.com \
#        ./setup-asterisk.sh
#
# Необязательные переменные:
#   PUBLIC_IP=...               (по умолчанию определяется автоматически)
#   SIP_ENDPOINT_PASSWORD=...   (по умолчанию генерится: openssl rand -hex 16)
#   BINOTEL_PORT=5060
#   ASTERISK_VERSION=22         (мажорная ветка LTS)
# ============================================================================
set -euo pipefail

# ── 0. Проверки и переменные ────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || { echo "Запускайте через sudo."; exit 1; }
: "${BINOTEL_USERNAME:?нужно BINOTEL_USERNAME=...}"
: "${BINOTEL_PASSWORD:?нужно BINOTEL_PASSWORD=...}"
: "${BINOTEL_SERVER:?нужно BINOTEL_SERVER=... (например sip52.binotel.com)}"
: "${LE_EMAIL:?нужно LE_EMAIL=... e-mail для сертификата}"
BINOTEL_PORT="${BINOTEL_PORT:-5060}"
ASTERISK_VERSION="${ASTERISK_VERSION:-22}"

PUBLIC_IP="${PUBLIC_IP:-$(curl -fsS ifconfig.me || curl -fsS https://api.ipify.org)}"
[[ -n "$PUBLIC_IP" ]] || { echo "Не удалось определить публичный IP — задайте PUBLIC_IP=..."; exit 1; }
SIP_DOMAIN="${PUBLIC_IP//./-}.nip.io"
SIP_ENDPOINT_PASSWORD="${SIP_ENDPOINT_PASSWORD:-$(openssl rand -hex 16)}"
ENDPOINT_USER="100"

echo "=== Параметры ==="
echo "PUBLIC_IP=$PUBLIC_IP"
echo "SIP_DOMAIN=$SIP_DOMAIN"
echo "Binotel: $BINOTEL_USERNAME @ $BINOTEL_SERVER:$BINOTEL_PORT"
echo "================="

# ── 1. Зависимости ──────────────────────────────────────────────────────────
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y build-essential git curl wget libssl-dev libncurses5-dev \
  libnewt-dev libxml2-dev libsqlite3-dev uuid-dev libjansson-dev libedit-dev \
  pkg-config subversion certbot ufw

# ── 2. Сборка Asterisk из исходников ────────────────────────────────────────
if [[ ! -x /usr/sbin/asterisk ]]; then
  cd /usr/src
  LATEST_TGZ="asterisk-${ASTERISK_VERSION}-current.tar.gz"
  wget -O "$LATEST_TGZ" "https://downloads.asterisk.org/pub/telephony/asterisk/${LATEST_TGZ}"
  rm -rf asterisk-${ASTERISK_VERSION}.*/ || true
  tar xzf "$LATEST_TGZ"
  SRC_DIR=$(find . -maxdepth 1 -type d -name "asterisk-${ASTERISK_VERSION}.*" | head -1)
  cd "$SRC_DIR"
  contrib/scripts/install_prereq install || true
  ./configure --with-jansson-bundled --with-pjproject-bundled
  make menuselect.makeopts
  # включаем нужные модули (res_http_websocket, res_pjsip, res_srtp, форматы)
  menuselect/menuselect \
    --enable res_http_websocket --enable res_pjsip --enable res_pjsip_transport_websocket \
    --enable res_srtp --enable chan_pjsip --enable codec_alaw --enable codec_ulaw \
    --enable format_wav --enable app_dial menuselect.makeopts
  make -j"$(nproc)"
  make install
  make samples
  make config
  ldconfig
fi

# Пользователь asterisk
id asterisk &>/dev/null || useradd -r -d /var/lib/asterisk -s /usr/sbin/nologin asterisk
sed -i 's/^;\?AST_USER=.*/AST_USER="asterisk"/' /etc/default/asterisk || true
sed -i 's/^;\?AST_GROUP=.*/AST_GROUP="asterisk"/' /etc/default/asterisk || true
chown -R asterisk:asterisk /var/{lib,log,spool,run}/asterisk /etc/asterisk 2>/dev/null || true

# ── 3. Сертификаты ──────────────────────────────────────────────────────────
# 3a) Let's Encrypt для WSS (домен nip.io). Порт 80 должен быть открыт и свободен.
systemctl stop asterisk 2>/dev/null || true
certbot certonly --standalone --non-interactive --agree-tos -m "$LE_EMAIL" -d "$SIP_DOMAIN" || {
  echo "!! Lets Encrypt не выдал сертификат. Проверьте, что порт 80 открыт и домен $SIP_DOMAIN резолвится."; }
LE_DIR="/etc/letsencrypt/live/$SIP_DOMAIN"

mkdir -p /etc/asterisk/keys
if [[ -f "$LE_DIR/fullchain.pem" ]]; then
  cp "$LE_DIR/fullchain.pem" /etc/asterisk/keys/wss-cert.pem
  cp "$LE_DIR/privkey.pem"   /etc/asterisk/keys/wss-key.pem
fi
# 3b) Self-signed для DTLS-SRTP (Asterisk не читает LE-privkey для DTLS) — грабля #4
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /etc/asterisk/keys/dtls-key.pem -out /etc/asterisk/keys/dtls-cert.pem \
  -subj "/CN=$SIP_DOMAIN" 2>/dev/null
cat /etc/asterisk/keys/dtls-cert.pem /etc/asterisk/keys/dtls-key.pem > /etc/asterisk/keys/dtls.pem
chown -R asterisk:asterisk /etc/asterisk/keys
chmod 640 /etc/asterisk/keys/*

# авто-продление LE + reload asterisk
cat >/etc/cron.d/le-asterisk <<EOF
0 3 * * * root certbot renew --quiet --deploy-hook "cp $LE_DIR/fullchain.pem /etc/asterisk/keys/wss-cert.pem && cp $LE_DIR/privkey.pem /etc/asterisk/keys/wss-key.pem && chown asterisk:asterisk /etc/asterisk/keys/wss-*.pem && asterisk -rx 'core reload'"
EOF

# ── 4. Конфиги Asterisk ─────────────────────────────────────────────────────
# http.conf — WSS-сервер (TLS) на :8089
cat >/etc/asterisk/http.conf <<EOF
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
tlsenable=yes
tlsbindaddr=0.0.0.0:8089
tlscertfile=/etc/asterisk/keys/wss-cert.pem
tlsprivatekey=/etc/asterisk/keys/wss-key.pem
EOF

# rtp.conf — диапазон RTP (совпадает с firewall UDP 10000-20000)
cat >/etc/asterisk/rtp.conf <<EOF
[general]
rtpstart=10000
rtpend=20000
icesupport=yes
stunaddr=stun.l.google.com:19302
EOF

# modules.conf — грабля #1: chan_sip перехватывает 5060 → выгружаем
cat >/etc/asterisk/modules.conf <<EOF
[modules]
autoload=yes
noload => chan_sip.so
EOF

# pjsip.conf — транспорты + endpoint 100 (браузер, WebRTC) + trunk Binotel
cat >/etc/asterisk/pjsip.conf <<EOF
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_media_address=$PUBLIC_IP
external_signaling_address=$PUBLIC_IP

[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0:8089

; ===== Браузерный endpoint 100 (WebRTC) =====
[$ENDPOINT_USER]
type=endpoint
context=from-internal
disallow=all
allow=alaw,ulaw            ; грабля #2: без opus-транскодинга
webrtc=yes
dtls_auto_generate_cert=no
dtls_cert_file=/etc/asterisk/keys/dtls-cert.pem
dtls_private_key=/etc/asterisk/keys/dtls-key.pem
dtls_verify=no
dtls_setup=actpass
ice_support=yes
media_use_received_transport=yes
rtcp_mux=yes
use_avpf=yes
media_encryption=dtls
aors=$ENDPOINT_USER
auth=${ENDPOINT_USER}-auth

[${ENDPOINT_USER}-auth]
type=auth
auth_type=userpass
username=$ENDPOINT_USER
password=$SIP_ENDPOINT_PASSWORD

[$ENDPOINT_USER]
type=aor
max_contacts=5
remove_existing=yes

; ===== SIP-trunk Binotel =====
[binotel-auth]
type=auth
auth_type=userpass
username=$BINOTEL_USERNAME
password=$BINOTEL_PASSWORD

[binotel-aor]
type=aor
contact=sip:$BINOTEL_SERVER:$BINOTEL_PORT

[binotel-reg]
type=registration
outbound_auth=binotel-auth
server_uri=sip:$BINOTEL_SERVER:$BINOTEL_PORT
client_uri=sip:$BINOTEL_USERNAME@$BINOTEL_SERVER:$BINOTEL_PORT
retry_interval=30
forbidden_retry_interval=300
expiration=300

[binotel]
type=endpoint
context=from-binotel
disallow=all
allow=alaw,ulaw
outbound_auth=binotel-auth
aors=binotel-aor
from_user=$BINOTEL_USERNAME
direct_media=no

[binotel-identify]
type=identify
endpoint=binotel
match=$BINOTEL_SERVER
EOF

# extensions.conf — исходящие через Binotel, входящие на endpoint 100
cat >/etc/asterisk/extensions.conf <<EOF
[general]
static=yes
writeprotect=no

; Эхо-тест 9000 (проверка звука)
[from-internal]
exten => 9000,1,Answer()
 same => n,Playback(demo-echotest)
 same => n,Echo()
 same => n,Hangup()
; Любой набранный номер → наружу через trunk Binotel
exten => _X.,1,NoOp(Outbound \${EXTEN})
 same => n,Set(CALLERID(num)=$BINOTEL_USERNAME)
 same => n,Dial(PJSIP/\${EXTEN}@binotel,60)
 same => n,Hangup()

; Входящие с Binotel → звонок в браузер (endpoint 100)
[from-binotel]
exten => _X.,1,NoOp(Inbound from \${CALLERID(num)})
 same => n,Dial(PJSIP/$ENDPOINT_USER,30)
 same => n,Hangup()
exten => s,1,Dial(PJSIP/$ENDPOINT_USER,30)
 same => n,Hangup()
EOF

chown -R asterisk:asterisk /etc/asterisk

# ── 5. Firewall (на случай если VM-firewall не открыт) ──────────────────────
ufw allow 22/tcp   || true
ufw allow 80/tcp   || true
ufw allow 443/tcp  || true
ufw allow 8089/tcp || true
ufw allow 5060/udp || true
ufw allow 3478/udp || true
ufw allow 10000:20000/udp || true
yes | ufw enable || true

# ── 6. Запуск ───────────────────────────────────────────────────────────────
systemctl enable asterisk
systemctl restart asterisk
sleep 5

echo
echo "============================================================"
echo " ГОТОВО. Значения для секретов Cloudflare Pages:"
echo
echo "   SIP_DOMAIN            = $SIP_DOMAIN"
echo "   SIP_ENDPOINT_PASSWORD = $SIP_ENDPOINT_PASSWORD"
echo "   (SIP_USER по умолчанию 100 — задавать не обязательно)"
echo
echo " Проверка состояния:"
echo "   sudo asterisk -rx 'pjsip show registrations'   # binotel-reg → Registered"
echo "   sudo asterisk -rx 'pjsip show transports'      # udp:5060 + wss:8089"
echo "   sudo asterisk -rx 'pjsip show endpoint 100'"
echo "   sudo journalctl -u asterisk -f"
echo "============================================================"
