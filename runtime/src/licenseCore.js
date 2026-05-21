const crypto = require('crypto');

function makeLicenseKey() {
  return 'LIC-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function nowIso(){ return new Date().toISOString(); }
function isExpired(expiresAt){ return !!expiresAt && new Date(expiresAt).getTime() < Date.now(); }
function publicLicense(lic = {}) {
  return {
    id: lic.id,
    key: lic.key,
    clientName: lic.clientName || '',
    status: lic.blocked ? 'blocked' : isExpired(lic.expiresAt) ? 'expired' : 'active',
    blocked: !!lic.blocked,
    expiresAt: lic.expiresAt || '',
    createdAt: lic.createdAt || '',
    updatedAt: lic.updatedAt || '',
    lastCheckAt: lic.lastCheckAt || '',
    lastIp: lic.lastIp || '',
    agentId: lic.agentId || '',
    online: lic.lastCheckAt ? (Date.now() - new Date(lic.lastCheckAt).getTime()) <= 15000 : false
  };
}
module.exports = { makeLicenseKey, nowIso, isExpired, publicLicense };
