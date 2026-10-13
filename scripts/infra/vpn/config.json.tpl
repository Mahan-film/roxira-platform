{
  "log": { "loglevel": "warning", "access": "none" },
  "policy": {
    "levels": { "0": { "handshake": 4, "connIdle": 300, "uplinkOnly": 2, "downlinkOnly": 5, "bufferSize": 512 } }
  },
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
        "sockopt": { "tcpFastOpen": true, "tcpKeepAliveIdle": 60, "tcpKeepAliveInterval": 30 },
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
      "sniffing": { "enabled": true, "destOverride": ["http", "tls"], "routeOnly": true }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct", "settings": { "domainStrategy": "UseIPv4" } },
    { "protocol": "blackhole", "tag": "block" }
  ],
  "routing": {
    "rules": [
      { "type": "field", "ip": ["geoip:private"], "outboundTag": "block" },
      { "type": "field", "network": "udp", "port": "443", "outboundTag": "block" }
    ]
  }
}
