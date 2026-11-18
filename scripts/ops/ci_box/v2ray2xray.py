#!/usr/bin/env python3
"""Convert a v2ray share link (vless/vmess/trojan/ss) or a client JSON into an Xray client config.
Reads the file given as argv[1]; writes the config JSON to stdout; prints only a one-line summary
(protocol/transport, no host or secret) to stderr. Local inbounds: SOCKS 10808, HTTP 10809."""
import base64, json, sys, urllib.parse as up

def b64(s):
    s = s.strip(); s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s) if ("-" in s or "_" in s) else base64.b64decode(s)

def stream(q, host_default):
    net = q.get("type", q.get("net", "tcp")) or "tcp"
    sec = q.get("security", q.get("tls", "")) or "none"
    st = {"network": net, "security": sec if sec in ("tls", "reality") else "none"}
    sni = q.get("sni") or q.get("host") or host_default
    if st["security"] == "tls":
        st["tlsSettings"] = {"serverName": sni, "fingerprint": q.get("fp", "chrome"),
                             **({"alpn": q["alpn"].split(",")} if q.get("alpn") else {})}
    if st["security"] == "reality":
        st["realitySettings"] = {"serverName": sni, "fingerprint": q.get("fp", "chrome"),
                                 "publicKey": q.get("pbk", ""), "shortId": q.get("sid", ""),
                                 "spiderX": q.get("spx", "")}
    if net == "ws":
        st["wsSettings"] = {"path": q.get("path", "/"), "headers": {"Host": q.get("host", sni)}}
    elif net == "grpc":
        st["grpcSettings"] = {"serviceName": q.get("serviceName", q.get("path", ""))}
    elif net in ("httpupgrade",):
        st["httpupgradeSettings"] = {"path": q.get("path", "/"), "host": q.get("host", sni)}
    elif net in ("xhttp", "splithttp"):
        st["xhttpSettings"] = {"path": q.get("path", "/"), "host": q.get("host", sni)}
    elif net == "tcp" and q.get("headerType") == "http":
        st["tcpSettings"] = {"header": {"type": "http", "request": {"path": [q.get("path", "/")],
                             "headers": {"Host": [q.get("host", sni)]}}}}
    return st, net, st["security"]

def outbound(link):
    link = link.strip()
    scheme = link.split("://", 1)[0].lower()
    if scheme == "vmess":
        j = json.loads(b64(link[8:].split("#")[0]))
        q = {k: str(v) for k, v in j.items()}
        st, net, sec = stream(q, q.get("add"))
        ob = {"protocol": "vmess", "settings": {"vnext": [{"address": q["add"], "port": int(q["port"]),
              "users": [{"id": q["id"], "alterId": int(q.get("aid", 0) or 0), "security": q.get("scy", "auto")}]}]},
              "streamSettings": st}
        return ob, f"vmess/{net}/{sec}"
    u = up.urlsplit(link)
    q = {k: v[0] for k, v in up.parse_qs(u.query).items()}
    host, port = u.hostname, u.port
    if scheme == "vless":
        st, net, sec = stream(q, host)
        user = {"id": up.unquote(u.username), "encryption": q.get("encryption", "none")}
        if q.get("flow"): user["flow"] = q["flow"]
        return {"protocol": "vless", "settings": {"vnext": [{"address": host, "port": port, "users": [user]}]},
                "streamSettings": st}, f"vless/{net}/{sec}"
    if scheme == "trojan":
        q.setdefault("security", "tls")
        st, net, sec = stream(q, host)
        return {"protocol": "trojan", "settings": {"servers": [{"address": host, "port": port,
                "password": up.unquote(u.username)}]}, "streamSettings": st}, f"trojan/{net}/{sec}"
    if scheme == "ss":
        userinfo = up.unquote(u.username or "")
        method, pw = (b64(userinfo).decode() if ":" not in userinfo else userinfo).split(":", 1)
        return {"protocol": "shadowsocks", "settings": {"servers": [{"address": host, "port": port,
                "method": method, "password": pw}]}}, "ss"
    raise SystemExit(f"unsupported link type: {scheme}")

def main():
    raw = open(sys.argv[1], encoding="utf-8").read().strip()
    if raw.startswith("{"):
        cfg = json.loads(raw)
        obs = [o for o in cfg.get("outbounds", []) if o.get("protocol") not in ("freedom", "blackhole", "dns")]
        if not obs: raise SystemExit("JSON has no proxy outbound")
        ob, kind = obs[0], obs[0].get("protocol", "?") + "/json"
    else:
        line = next(l for l in raw.splitlines() if "://" in l)
        ob, kind = outbound(line)
    ob["tag"] = "proxy"
    cfg = {"log": {"loglevel": "warning"},
           "inbounds": [{"tag": "socks", "listen": "127.0.0.1", "port": 10808, "protocol": "socks",
                         "settings": {"udp": True}},
                        {"tag": "http", "listen": "127.0.0.1", "port": 10809, "protocol": "http"}],
           "outbounds": [ob, {"tag": "direct", "protocol": "freedom"}]}
    json.dump(cfg, sys.stdout, indent=1)
    print(f"converted: {kind}", file=sys.stderr)

main()
