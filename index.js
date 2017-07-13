'use strict'
const util = require('util')
const EventEmitter = require('events').EventEmitter

const NOOP = function () { }

const Pool = module.exports = function (options, Client) {
  if (!(this instanceof Pool)) {
    return new Pool(options, Client)
  }
  EventEmitter.call(this)
  this.options = Object.assign({}, options)
  this.log = this.options.log || function () { }
  this.Client = this.options.Client || Client || require('pg').Client
  this.Promise = this.options.Promise || global.Promise
  this._clients = []
  this._idle = []
  this._pendingQueue = []
  this._endCallback = undefined
  this.ending = false

  this.options.max = this.options.max || this.options.poolSize || 10
}

util.inherits(Pool, EventEmitter)

Pool.prototype._isFull = function () {
  return this._clients.length >= this.options.max
}

Pool.prototype._pulseQueue = function () {
  this.log('pulse queue')
  if (this.ending) {
    this.log('pulse queue on ending')
    if (this._idle.length) {
      this._idle.map(item => {
        this._remove(item.client)
      })
    }
    if (!this._clients.length) {
      this._endCallback()
    }
    return
  }
  // if we don't have any waiting, do nothing
  if (!this._pendingQueue.length) {
    this.log('no queued requests')
    return
  }
  // if we don't have any idle clients and we have no more room do nothing
  if (!this._idle.length && this._isFull()) {
    return
  }
  const waiter = this._pendingQueue.shift()
  if (this._idle.length) {
    const idleItem = this._idle.pop()
    clearTimeout(idleItem.timeoutId)
    const client = idleItem.client
    client.release = release.bind(this, client)
    this.emit('acquire', client)
    return waiter(undefined, client, client.release)
  }
  if (!this._isFull()) {
    return this.connect(waiter)
  }
  throw new Error('unexpected condition')
}

Pool.prototype._promisify = function (callback) {
  if (callback) {
    return { callback: callback, result: undefined }
  }
  let reject
  let resolve
  const cb = function (err, client) {
    err ? reject(err) : resolve(client)
  }
  const result = new this.Promise(function (res, rej) {
    resolve = res
    reject = rej
  })
  return { callback: cb, result: result }
}

Pool.prototype._remove = function (client) {
  this._idle = this._idle.filter(item => item.client !== client)
  this._clients = this._clients.filter(c => c !== client)
  client.end()
  this.emit('remove', client)
}

class IdleItem {
  constructor (client, timeoutId) {
    this.client = client
    this.timeoutId = timeoutId
  }
}

function throwOnRelease() {
  throw new Error('Release called on client which has already been released to the pool.')
}

function release (client, err) {
  client.release = throwOnRelease
  if (err) {
    this._remove(client)
    this._pulseQueue()
    return
  }

  // idle timeout
  let tid
  if (this.options.idleTimeoutMillis) {
    tid = setTimeout(() => {
      this.log('remove idle client')
      this._remove(client)
    }, this.idleTimeoutMillis)
  }

  if (this.ending) {
    this._remove(client)
  } else {
    this._idle.push(new IdleItem(client, tid))
  }
  this._pulseQueue()
}

Pool.prototype.connect = function (cb) {
  if (this.ending) {
    const err = new Error('Cannot use a pool after calling end on the pool')
    return cb ? cb(err) : this.Promise.reject(err)
  }
  if (this._clients.length >= this.options.max || this._idle.length) {
    const response = this._promisify(cb)
    const result = response.result
    this._pendingQueue.push(response.callback)
    // if we have idle clients schedule a pulse immediately
    if (this._idle.length) {
      process.nextTick(() => this._pulseQueue())
    }
    return result
  }

  const client = new this.Client(this.options)
  this._clients.push(client)
  const idleListener = (err) => {
    err.client = client
    client.removeListener('error', idleListener)
    client.on('error', () => {
      this.log('additional client error after disconnection due to error', err)
    })
    this._remove(client)
    // TODO - document that once the pool emits an error
    // the client has already been closed & purged and is unusable
    this.emit('error', err, client)
  }

  this.log('connecting new client')

  // connection timeout logic
  let tid
  let timeoutHit = false
  if (this.options.connectionTimeoutMillis) {
    tid = setTimeout(() => {
      this.log('ending client due to timeout')
      timeoutHit = true
      // force kill the node driver, and let libpq do its teardown
      client.connection ? client.connection.stream.destroy() : client.end()
    }, this.options.connectionTimeoutMillis)
  }

  const response = this._promisify(cb)
  cb = response.callback

  this.log('connecting new client')
  client.connect((err) => {
    this.log('new client connected')
    if (tid) {
      clearTimeout(tid)
    }
    client.on('error', idleListener)
    if (err) {
      // remove the dead client from our list of clients
      this._clients = this._clients.filter(c => c !== client)
      if (timeoutHit) {
        err.message = 'Connection terminiated due to connection timeout'
      }
      cb(err, undefined, NOOP)
    } else {
      client.release = release.bind(this, client)
      this.emit('connect', client)
      this.emit('acquire', client)
      if (this.options.verify) {
        this.options.verify(client, cb)
      } else {
        cb(undefined, client, client.release)
      }
    }
  })
  return response.result
}

Pool.prototype.query = function (text, values, cb) {
  if (typeof values === 'function') {
    cb = values
    values = undefined
  }
  const response = this._promisify(cb)
  cb = response.callback
  this.connect((err, client) => {
    if (err) {
      return cb(err)
    }
    this.log('dispatching query')
    client.query(text, values, (err, res) => {
      this.log('query dispatched')
      client.release(err)
      if (err) {
        return cb(err)
      } else {
        return cb(undefined, res)
      }
    })
  })
  return response.result
}

Pool.prototype.end = function (cb) {
  this.log('ending')
  if (this.ending) {
    const err = new Error('Called end on pool more than once')
    return cb ? cb(err) : this.Promise.reject(err)
  }
  this.ending = true
  const promised = this._promisify(cb)
  this._endCallback = promised.callback
  this._pulseQueue()
  return promised.result
}

Object.defineProperty(Pool.prototype, 'waitingCount', {
  get: function () {
    return this._pendingQueue.length
  }
})

Object.defineProperty(Pool.prototype, 'idleCount', {
  get: function () {
    return this._idle.length
  }
})

Object.defineProperty(Pool.prototype, 'totalCount', {
  get: function () {
    return this._clients.length
  }
})
