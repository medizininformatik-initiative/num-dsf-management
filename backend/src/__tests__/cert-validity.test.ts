/**
 * cert-validity.test.ts – The proxy requests client certificates with
 * optional_no_ca, which does not check the validity period, so the backend
 * must: a presented certificate outside notBefore/notAfter is no client
 * certificate (extractClientCert → null), and an admin certificate whose
 * recorded valid_until has passed no longer logs in or binds a session.
 * Dependencies: lib/clientCert, auth.service, db, node-forge
 */
import type { Request } from 'express';
import crypto from 'crypto';
import forge from 'node-forge';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection';
import { extractClientCert } from '../lib/clientCert';
import { findCertBinding, resolveCertLogin } from '../services/auth.service';

function certPem(notBefore: Date, notAfter: Date): string {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '03';
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const attrs = [{ shortName: 'CN', value: `validity-${uuidv4().slice(0, 8)}.example.de` }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

const DAY = 24 * 3600 * 1000;
const presented = (pem: string) =>
  extractClientCert({
    headers: { 'x-client-verify': 'SUCCESS', 'x-client-cert': encodeURIComponent(pem) },
  } as unknown as Request);

describe('extractClientCert validity period', () => {
  it('accepts a certificate inside its validity period', () => {
    const pem = certPem(new Date(Date.now() - DAY), new Date(Date.now() + DAY));
    expect(presented(pem)?.fingerprint).toMatch(/^[0-9a-f]{128}$/);
  });

  it('refuses an expired certificate', () => {
    expect(presented(certPem(new Date('2020-01-01'), new Date(Date.now() - DAY)))).toBeNull();
  });

  it('refuses a certificate that is not valid yet', () => {
    expect(presented(certPem(new Date(Date.now() + DAY), new Date('2040-01-01')))).toBeNull();
  });
});

describe('admin_cert_fingerprints.valid_until', () => {
  const email = `validity-admin-${uuidv4().slice(0, 8)}@imi-test.example.de`;
  const fingerprint = crypto.createHash('sha512').update(email).digest('hex');

  beforeAll(async () => {
    await db('email_whitelist').insert({ id: uuidv4(), email, created_at: new Date() });
    await db('admin_cert_fingerprints').insert({
      id: uuidv4(),
      email,
      fingerprint,
      valid_until: new Date(Date.now() - DAY),
      created_by: 'test',
      created_at: new Date(),
    });
  });

  afterAll(async () => {
    await db('admin_cert_fingerprints').where({ email }).del();
    await db('email_whitelist').where({ email }).del();
    await db('users').where({ email }).del();
  });

  it('an expired admin certificate neither logs in nor binds a session', async () => {
    expect(await resolveCertLogin(fingerprint)).toBeNull();
    expect(await findCertBinding(fingerprint)).toBeNull();
  });
});
