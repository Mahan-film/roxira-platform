#!/usr/bin/env python3
"""Tiny TCP forwarder: LISTEN_ADDR:PORT -> 127.0.0.1:TARGET_PORT.

Docker Desktop on macOS cannot publish a container port on the LAN address reliably (connections get an
empty reply), so the container is published on 127.0.0.1 only and this process exposes it on ONE LAN address.
Refuses 0.0.0.0 and loopback as the listen address. No logging of payloads.
usage: lan_forward.py <listen_addr> <listen_port> <target_port>
"""
import asyncio
import sys


async def pipe(r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
    try:
        while data := await r.read(65536):
            w.write(data)
            await w.drain()
    except (OSError, asyncio.CancelledError):
        pass
    finally:
        w.close()


async def handle(cr: asyncio.StreamReader, cw: asyncio.StreamWriter, target: int) -> None:
    try:
        ur, uw = await asyncio.open_connection("127.0.0.1", target)
    except OSError:
        cw.close()
        return
    await asyncio.gather(pipe(cr, uw), pipe(ur, cw))


async def main(addr: str, port: int, target: int) -> None:
    if addr in ("0.0.0.0", "::", "") or addr.startswith("127."):
        sys.exit("lan_forward: listen address must be one LAN/Tailscale address")
    server = await asyncio.start_server(lambda r, w: handle(r, w, target), addr, port)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3])))
