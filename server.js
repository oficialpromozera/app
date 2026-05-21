// Bootstrap protegido do Agent. O código real do painel fica empacotado em .agent/vault.dat.
// Observação honesta: em Node.js nenhuma proteção local é 100% inviolável; isto dificulta cópia e edição casual.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const runtime = path.join(__dirname, '.runtime');
const vault = path.join(__dirname, '.agent', 'vault.dat');
const keyFile = path.join(__dirname, '.agent', 'key.txt');
function extractZip(zipPath, dest){
  try { childProcess.execFileSync('powershell.exe', ['-NoProfile','-Command', `Expand-Archive -Force '${zipPath}' '${dest}'`], { stdio: 'ignore' }); }
  catch { childProcess.execFileSync('unzip', ['-oq', zipPath, '-d', dest], { stdio: 'ignore' }); }
}
function decryptVault(){
  if (!fs.existsSync(vault) || !fs.existsSync(keyFile)) throw new Error('Arquivos protegidos do Agent não encontrados.');
  fs.rmSync(runtime, { recursive: true, force: true });
  fs.mkdirSync(runtime, { recursive: true });
  const buf = fs.readFileSync(vault);
  const iv = buf.subarray(0, 16);
  const enc = buf.subarray(16);
  const key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  const zipPath = path.join(runtime, 'app.zip');
  fs.writeFileSync(zipPath, out);
  extractZip(zipPath, runtime);
  fs.unlinkSync(zipPath);
}
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'database.json');
process.env.AGENT_DATA_DIR = process.env.AGENT_DATA_DIR || path.join(__dirname, 'data');
decryptVault();
require(path.join(runtime, 'server.js'));
