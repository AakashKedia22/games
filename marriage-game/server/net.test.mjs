import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLanAddress, pickLanAddresses } from './net.mjs';

test('prefers the primary LAN interface and omits VPN, virtual and internal addresses', () => {
  const interfaces = {
    utun4: [{ address: '10.8.0.4', family: 'IPv4', internal: false }],
    en1: [{ address: '192.168.1.25', family: 'IPv4', internal: false }],
    docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
    en0: [
      { address: '::1', family: 'IPv6', internal: true },
      { address: '127.0.0.1', family: 'IPv4', internal: true },
      { address: '192.168.1.42', family: 'IPv4', internal: false }
    ]
  };

  assert.deepEqual(pickLanAddresses(interfaces), ['192.168.1.42', '192.168.1.25']);
  assert.equal(pickLanAddress(interfaces), '192.168.1.42');
});

test('accepts private IPv4 ranges and rejects public and link-local addresses', () => {
  const interfaces = {
    eth0: [
      { address: '8.8.8.8', family: 'IPv4', internal: false },
      { address: '169.254.10.4', family: 'IPv4', internal: false },
      { address: '172.16.4.2', family: 'IPv4', internal: false },
      { address: '172.32.4.2', family: 'IPv4', internal: false }
    ]
  };

  assert.deepEqual(pickLanAddresses(interfaces), ['172.16.4.2']);
});
