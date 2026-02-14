#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SESSION_DIR = process.env.SESSION_DIR || './sessions';

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, {recursive: true});
  }
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function saveDraft(content) {
  ensureDir();
  fs.writeFileSync(path.join(SESSION_DIR, 'draft.md'), content);
  console.log('草稿已保存');
}

function loadDraft() {
  const draftPath = path.join(SESSION_DIR, 'draft.md');
  if (fs.existsSync(draftPath)) {
    return fs.readFileSync(draftPath, 'utf-8');
  }
  return null;
}

function clearDraft() {
  const draftPath = path.join(SESSION_DIR, 'draft.md');
  if (fs.existsSync(draftPath)) {
    fs.unlinkSync(draftPath);
  }
}

function listSessions() {
  ensureDir();
  const files = fs
    .readdirSync(SESSION_DIR)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort()
    .reverse();
  return files;
}

function loadSession(date) {
  const filePath = path.join(SESSION_DIR, `${date}.md`);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
}

function saveSession(date, content) {
  ensureDir();
  const filePath = path.join(SESSION_DIR, `${date}.md`);
  fs.writeFileSync(filePath, content);
  console.log(`会话已保存: ${date}`);
}

function loadMemory() {
  const memPath = path.join(SESSION_DIR, 'MEMORY.md');
  if (fs.existsSync(memPath)) {
    return fs.readFileSync(memPath, 'utf-8');
  }
  return '';
}

function updateMemory(content) {
  ensureDir();
  const memPath = path.join(SESSION_DIR, 'MEMORY.md');
  fs.writeFileSync(memPath, content);
  console.log('长期记忆已更新');
}

function loadRecentSessions() {
  const memory = loadMemory();
  const today = getToday();
  const yesterday = getYesterday();

  const recent = [yesterday, today]
    .map(date => ({date, content: loadSession(date)}))
    .filter(s => s.content);

  return {memory, recent};
}

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'save-draft':
    saveDraft(args[1]);
    break;
  case 'load-draft':
    console.log(loadDraft() || '');
    break;
  case 'clear-draft':
    clearDraft();
    break;
  case 'has-draft':
    console.log(
      fs.existsSync(path.join(SESSION_DIR, 'draft.md')) ? 'yes' : 'no',
    );
    break;
  case 'list':
    console.log(listSessions().join('\n'));
    break;
  case 'load':
    console.log(loadSession(args[1]) || '');
    break;
  case 'save':
    saveSession(args[1], args[2]);
    break;
  case 'memory':
    console.log(loadMemory());
    break;
  case 'update-memory':
    updateMemory(args[1]);
    break;
  case 'recent':
    const {memory, recent} = loadRecentSessions();
    console.log(JSON.stringify({memory, recent}));
    break;
  default:
    console.log('Usage:');
    console.log('  node session-mgr.js save-draft <content>');
    console.log('  node session-mgr.js load-draft');
    console.log('  node session-mgr.js clear-draft');
    console.log('  node session-mgr.js has-draft');
    console.log('  node session-mgr.js list');
    console.log('  node session-mgr.js load <date>');
    console.log('  node session-mgr.js save <date> <content>');
    console.log('  node session-mgr.js memory');
    console.log('  node session-mgr.js update-memory <content>');
    console.log('  node session-mgr.js recent');
}
