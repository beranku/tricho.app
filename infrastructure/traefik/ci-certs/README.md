# CI self-signed certificate

`tricho.test.crt` / `tricho.test.key` are **not secrets** — `tricho.test` is a
reserved TLD per RFC 6761 that never resolves on the public internet, so this
cert's private key gives an attacker nothing. They're committed to the repo
so CI runners pick them up via a plain checkout.

## Regenerate

```sh
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout tricho.test.key \
  -out tricho.test.crt \
  -subj "/CN=tricho.test" \
  -addext "subjectAltName=DNS:tricho.test,DNS:localhost,IP:127.0.0.1"
```
