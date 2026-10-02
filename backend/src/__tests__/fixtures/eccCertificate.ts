// Purpose: Public EC (P-256) test certificate for the certificate parsing and
// fingerprint tests: self-signed, C=DE O=ECC Test CN=dsf-client.ecc.example.de,
// valid until 2036-09-29. Certificate only, no key material. GEANT and HARICA
// issue EC certificates to DSF sites, which node-forge could not parse.
// Dependencies: none

export const ECC_P256_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBvTCCAWKgAwIBAgIUFrLF0FPYTbwMo6cQmFxFTlN4PLAwCgYIKoZIzj0EAwIw
RDELMAkGA1UEBhMCREUxETAPBgNVBAoMCEVDQyBUZXN0MSIwIAYDVQQDDBlkc2Yt
Y2xpZW50LmVjYy5leGFtcGxlLmRlMB4XDTI2MTAwMjEwNTQ0MVoXDTM2MDkyOTEw
NTQ0MVowRDELMAkGA1UEBhMCREUxETAPBgNVBAoMCEVDQyBUZXN0MSIwIAYDVQQD
DBlkc2YtY2xpZW50LmVjYy5leGFtcGxlLmRlMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAElYNILrWh5lZ/O4yJSfW8+iUF2LUGkD9wsVLntxyO9YQSV9K8czcinWDb
uplFBeIJ/KGVL0pDwXzZaEeAViqfo6MyMDAwCQYDVR0TBAIwADAOBgNVHQ8BAf8E
BAMCB4AwEwYDVR0lBAwwCgYIKwYBBQUHAwIwCgYIKoZIzj0EAwIDSQAwRgIhAMIL
Yx1bjbAaPu1n4HkRrSdvr5zq/fcAf8IiYI3cK3lcAiEAqfShMSHrZI4+s6WIosus
zn9dBPt5lK8KfGm91HDf538=
-----END CERTIFICATE-----
`;

/** `openssl x509 -outform DER | openssl dgst -sha512` of the certificate above. */
export const ECC_P256_SHA512 =
  'ea5a0a7467478781a6e090cb8036dd91a9d0ae8b86e17968b7bb1b96ddc9708f' +
  '7d6aa6a4aad42ce08592ebbf693f4ac7bb6319ba4cd67e54eb0400885be64bd9';
