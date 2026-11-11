import { isIPv4 } from 'node:net';

const VIRTUAL_INTERFACE = /^(docker|veth|br-|bridge|utun|vmnet|vmenet|vbox|virbr|vnic|tailscale|tun\d|tap\d|wg\d|zt\d|awdl|llw|lo\d|gif\d|stf\d)/i;

function isPrivateIPv4(address) {
  if (!isIPv4(address)) return false;
  const octets = address.split('.').map(Number);
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function interfacePriority(name) {
  if (/^(en0|eth0|wlan0|wifi0)$/i.test(name)) return 0;
  if (/^(en|eth|wlan|wifi)\d+$/i.test(name)) return 1;
  return 2;
}

export function pickLanAddresses(interfaces) {
  const candidates = [];

  for (const [name, addresses] of Object.entries(interfaces || {})) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const item of addresses || []) {
      if (item.internal || (item.family !== 'IPv4' && item.family !== 4) || !isPrivateIPv4(item.address)) continue;
      candidates.push({ address: item.address, priority: interfacePriority(name) });
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return [...new Set(candidates.map(candidate => candidate.address))];
}

export function pickLanAddress(interfaces) {
  return pickLanAddresses(interfaces)[0] || null;
}
