    {
      "listen": "0.0.0.0",
      "port": __PORT2__,
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
          "dest": "__DEST2__",
          "xver": 0,
          "serverNames": ["__SNI2__"],
          "privateKey": "__PRIVATE_KEY2__",
          "shortIds": [__SHORT_IDS2__]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls"], "routeOnly": true }
    }
