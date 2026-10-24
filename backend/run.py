"""Start the server on all network interfaces so a phone on the same Wi-Fi can reach it."""

import socket

import uvicorn

from app.config import PORT


def local_ip() -> str:
    # Connecting a UDP socket sends no data; it just reveals which interface we'd use.
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    print(f"\nOn this computer:  http://127.0.0.1:{PORT}")
    print(f"On your phone:     http://{local_ip()}:{PORT}   (same Wi-Fi)")
    print(f"Upload test page:  http://127.0.0.1:{PORT}/test\n")
    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT)
