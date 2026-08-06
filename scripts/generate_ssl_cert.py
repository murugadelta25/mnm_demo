#!/usr/bin/env python3
"""Generate a self-signed TLS certificate for EAP PMS (din.eappms / LAN).

Used by install-nginx.sh and Install-Nginx.ps1 when useHttps is true and
certificate files are missing. Prefers the cryptography package; falls back
to the openssl CLI.

Optional --san-ip values are added so https://<lan-ip> works without a
hostname mismatch (still self-signed / untrusted until a company CA is used).
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import shutil
import subprocess
import sys
from pathlib import Path


def _parse_ips(values: list[str]) -> list:
    ips = []
    seen = set()
    for raw in values:
        text = (raw or "").strip()
        if not text:
            continue
        try:
            ip = ipaddress.ip_address(text)
        except ValueError:
            print(f"Skipping invalid SAN IP: {text}", file=sys.stderr)
            continue
        # Deduplicate by canonical IP value so "192.168.1.1" and
        # "192.168.001.001" only produce one SAN entry.
        if ip in seen:
            continue
        seen.add(ip)
        ips.append(ip)
    return ips


def _write_via_cryptography(
    cert_path: Path, key_path: Path, cn: str, days: int, san_ips: list
) -> None:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    san = [
        x509.DNSName(cn),
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
    ]
    for ip in san_ips:
        san.append(x509.IPAddress(ip))
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=days))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )

    cert_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    try:
        key_path.chmod(0o600)
        cert_path.chmod(0o644)
    except OSError:
        pass


def _write_via_openssl(
    cert_path: Path, key_path: Path, cn: str, days: int, san_ips: list
) -> None:
    openssl = shutil.which("openssl")
    if not openssl:
        raise RuntimeError("openssl not found on PATH")

    cert_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.parent.mkdir(parents=True, exist_ok=True)
    san_parts = [f"DNS:{cn}", "DNS:localhost", "IP:127.0.0.1"]
    for ip in san_ips:
        san_parts.append(f"IP:{ip}")
    san_line = ",".join(san_parts)
    cfg = cert_path.with_suffix(".openssl.cnf")
    cfg.write_text(
        "\n".join(
            [
                "[req]",
                "distinguished_name = req_distinguished_name",
                "x509_extensions = v3_req",
                "prompt = no",
                "[req_distinguished_name]",
                f"CN = {cn}",
                "[v3_req]",
                "basicConstraints = CA:FALSE",
                "keyUsage = digitalSignature, keyEncipherment",
                "extendedKeyUsage = serverAuth",
                f"subjectAltName = {san_line}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    try:
        subprocess.run(
            [
                openssl,
                "req",
                "-x509",
                "-nodes",
                "-newkey",
                "rsa:2048",
                "-keyout",
                str(key_path),
                "-out",
                str(cert_path),
                "-days",
                str(days),
                "-config",
                str(cfg),
                "-extensions",
                "v3_req",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    finally:
        cfg.unlink(missing_ok=True)
    try:
        key_path.chmod(0o600)
        cert_path.chmod(0o644)
    except OSError:
        pass


def generate(
    cert_path: Path,
    key_path: Path,
    cn: str,
    days: int = 825,
    san_ips: list | None = None,
    force: bool = False,
) -> None:
    if not force and cert_path.is_file() and key_path.is_file():
        print(f"SSL cert already exists: {cert_path}")
        return

    ips = san_ips or []
    try:
        _write_via_cryptography(cert_path, key_path, cn, days, ips)
        print(f"Created self-signed cert (cryptography): {cert_path}")
        return
    except Exception as exc:  # noqa: BLE001 — fall back to openssl
        print(f"cryptography path unavailable ({exc}); trying openssl...", file=sys.stderr)

    _write_via_openssl(cert_path, key_path, cn, days, ips)
    print(f"Created self-signed cert (openssl): {cert_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate EAP PMS self-signed TLS cert")
    parser.add_argument("--cert", required=True, help="Output certificate path (.crt/.pem)")
    parser.add_argument("--key", required=True, help="Output private key path (.key)")
    parser.add_argument("--cn", default="din.eappms", help="Certificate common name / DNS")
    parser.add_argument("--days", type=int, default=825, help="Validity in days")
    parser.add_argument(
        "--san-ip",
        action="append",
        default=[],
        help="Extra IP for subjectAltName (repeatable). Helps https://IP access.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing certificate files",
    )
    args = parser.parse_args()
    try:
        generate(
            Path(args.cert),
            Path(args.key),
            args.cn,
            args.days,
            _parse_ips(args.san_ip),
            force=args.force,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: failed to generate SSL certificate: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
