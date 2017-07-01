var expect = require('expect.js')
var _ = require('lodash')

var describe = require('mocha').describe
var it = require('mocha').it
var BluebirdPromise = require('bluebird')

var Pool = require('../')

describe('Bring your own promise', function () {
  it('uses supplied promise for operations', (done) => {
    const pool = new Pool({ Promise: BluebirdPromise })
    const promise = pool.connect()
    expect(promise).to.be.a(BluebirdPromise)
    promise.then(() => {
      const queryPromise = pool.query('SELECT NOW()')
      expect(queryPromise).to.be.a(BluebirdPromise)
      queryPromise.then(() => {
        const connectPromise = pool.connect()
        expect(connectPromise).to.be.a(BluebirdPromise)
        connectPromise.then(client => {
          pool.end(done)
        })
      })
    })
  })
})
