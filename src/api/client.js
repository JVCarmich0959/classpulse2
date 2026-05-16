import { SB_URL, SB_KEY } from '../config.js';

var realtimeAuthToken = null;

function realtimeUrl() {
  return String(SB_URL || '').replace(/^http/i, 'ws') + '/realtime/v1/websocket?apikey=' +
    encodeURIComponent(SB_KEY || '') + '&vsn=1.0.0';
}

function RealtimeChannel(name) {
  this.name = name;
  this.topic = 'realtime:' + name;
  this.bindings = [];
  this.socket = null;
  this.ref = 1;
  this.heartbeat = null;
}

RealtimeChannel.prototype.on = function(eventName, filter, callback) {
  this.bindings.push({ eventName: eventName, filter: filter || {}, callback: callback });
  return this;
};

RealtimeChannel.prototype._nextRef = function() {
  return String(this.ref++);
};

RealtimeChannel.prototype._send = function(eventName, payload) {
  if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
  this.socket.send(JSON.stringify({
    topic: eventName === 'heartbeat' ? 'phoenix' : this.topic,
    event: eventName,
    payload: payload || {},
    ref: this._nextRef()
  }));
};

RealtimeChannel.prototype.subscribe = function(callback) {
  var self = this;
  if (typeof WebSocket === 'undefined' || !SB_URL || !SB_KEY) {
    if (callback) callback('CLOSED');
    return this;
  }
  this.socket = new WebSocket(realtimeUrl());
  this.socket.onopen = function() {
    var postgresChanges = self.bindings
      .filter(function(b) { return b.eventName === 'postgres_changes'; })
      .map(function(b) { return b.filter; });
    self._send('phx_join', {
      config: {
        broadcast: { self: false },
        presence: { key: '' },
        postgres_changes: postgresChanges
      },
      access_token: realtimeAuthToken || SB_KEY
    });
    self.heartbeat = setInterval(function() { self._send('heartbeat', {}); }, 25000);
    if (callback) callback('SUBSCRIBED');
  };
  this.socket.onmessage = function(evt) {
    var msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    if (msg.event !== 'postgres_changes') return;
    var payload = msg.payload || {};
    var data = payload.data || payload;
    var record = data.record || data.new || payload.record || payload.new;
    var oldRecord = data.old_record || data.old || payload.old_record || payload.old;
    var eventType = data.type || data.eventType || payload.type || payload.eventType;
    self.bindings.forEach(function(b) {
      if (b.eventName !== 'postgres_changes') return;
      if (b.filter && b.filter.event && eventType && b.filter.event !== eventType) return;
      b.callback({
        schema: data.schema || (b.filter && b.filter.schema),
        table: data.table || (b.filter && b.filter.table),
        commit_timestamp: data.commit_timestamp || payload.commit_timestamp,
        eventType: eventType,
        new: record,
        old: oldRecord,
        errors: data.errors || payload.errors || null
      });
    });
  };
  this.socket.onerror = function() { if (callback) callback('CHANNEL_ERROR'); };
  this.socket.onclose = function() {
    if (self.heartbeat) clearInterval(self.heartbeat);
    self.heartbeat = null;
    if (callback) callback('CLOSED');
  };
  return this;
};

RealtimeChannel.prototype.unsubscribe = function() {
  if (this.heartbeat) clearInterval(this.heartbeat);
  this.heartbeat = null;
  if (this.socket && this.socket.readyState === WebSocket.OPEN) this._send('phx_leave', {});
  if (this.socket) this.socket.close();
  this.socket = null;
};

export var supabase = {
  setAuthToken: function(token) { realtimeAuthToken = token || null; },
  channel: function(name) { return new RealtimeChannel(name); },
  removeChannel: function(channel) {
    if (channel && typeof channel.unsubscribe === 'function') channel.unsubscribe();
  }
};
export { authedFetch, authedInsert, authedSelect } from '../main.js';
