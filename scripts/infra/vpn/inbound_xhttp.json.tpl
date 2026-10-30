    {
      "listen": "0.0.0.0",
      "port": __XHTTP_PORT__,
      "protocol": "vless",
      "settings": {
        "clients": [
__CLIENTS_PLAIN__
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "xhttp",
        "security": "none",
        "xhttpSettings": { "path": "__XHTTP_PATH__", "host": "__XHTTP_HOST__", "mode": "auto" }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls"], "routeOnly": true }
    }
