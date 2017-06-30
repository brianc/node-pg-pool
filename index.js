var util = require('util')
var EventEmitter = require('events').EventEmitter

var Pool = module.exports = function (options, Client) {
  if (!(this instanceof Pool)) {
    return new Pool(options, Client)
  }
  EventEmitter.call(this)
  this.options = Object.assign({}, Pool.defaults, options)
  this.log = this.options.log || function () { }
  this.Client = this.options.Client || Client || require('pg').Client
  this.Promise = this.options.Promise || global.Promise
  this._clients = []

  this.options.max = this.options.max || this.options.poolSize || 10

  if (this.options.create) {
    throw new Error('support custom create')
  }

  if (this.options.destroy) {
    throw new Error('support custom destroy')
  }
}

Pool.defaults = {
}

util.inherits(Pool, EventEmitter)

Pool.prototype._promiseNoCallback = function (callback, executor) {
  return callback
    ? executor()
    : new this.Promise(executor)
}

Pool.prototype.connect = function (cb) {
  if (this._clients.length >= this.options.max) {
    throw new Error('pool is full')
  }
  const client = new this.Client(this.options)
  this._clients.push(client)
  const idleListener = (err) => {
    err.client = client
    this.emit('error', err, client)
    client.removeListener('error', idleListener)
    client.on('error', () => {
      this.log('additional client error after disconnection due to error', err)
    })
    client.end()
  }
  let result = undefined
  if (!cb) {
    let reject = undefined
    let resolve = undefined
    cb = function (err, client) {
      err ? reject(err) : resolve(client)
    }
    result = new Promise(function (res, rej) {
      resolve = res
      reject = rej
    })
  }
  client.connect(function (err) {
    const release = function release() {
      client.on('error', idleListener)
    }
    if (err) {
      cb(err, undefined, function() { })
    } else {
      client.release = release
      cb(undefined, client, release)
    }
  })
  return result
}

Pool.prototype.query = function (text, values, cb) {
  if (typeof values == 'function') {
    cb = values
    values = undefined
  }
  let result = undefined
  if (!cb) {
    let reject = undefined
    let resolve = undefined
    cb = function (err, res) {
      err ? reject(err) : resolve(res)
    }
    result = new Promise(function (res, rej) {
      resolve = res
      reject = rej
    })
  }
  this.connect(function (err, client) {
    if (err) {
      return cb(err)
    }
    client.query(text, values, function (err, res) {
      client.release()
      if (err) {
        return cb(err)
      } else {
        return cb(undefined, res)
      }
    })
  })
  return result
}

Pool.prototype.end = function (cb) {
  const promises = this._clients.map(client => client.end())
  if (!cb) {
    return Promise.all(promises)
  }
  Promise.all(promises)
    .then(() => cb ? cb() : undefined)
    .catch(err => {
      console.log('end error', err)
      cb(err)
    })
}
