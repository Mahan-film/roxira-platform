{
  "log": { "loglevel": "warning", "access": "none" },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": __PORT__,
      "protocol": "vless",
      "settings": {
        "clients": [
__CLIENTS__
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "__DEST__",
          "xver": 0,
          "serverNames": ["__SNI__"],
          "privateKey": "__PRIVATE_KEY__",
          "shortIds": [__SHORT_IDS__]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ],
  "routing": {
    "rules": [
      { "type": "field", "ip": ["geoip:private"], "outboundTag": "block" }
    ]
  }
}
