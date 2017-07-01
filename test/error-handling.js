var co = require('co')
var expect = require('expect.js')
var _ = require('lodash')

var describe = require('mocha').describe
var it = require('mocha').it
var Promise = require('bluebird')

var Pool = require('../')

describe('pool error handling', function () {
  it('Should complete these queries without dying', function (done) {
    var pool = new Pool()
    var errors = 0
    var shouldGet = 0
    function runErrorQuery () {
      shouldGet++
      return new Promise(function (resolve, reject) {
        pool.query("SELECT 'asd'+1 ").then(function (res) {
          reject(res) // this should always error
        }).catch(function (err) {
          errors++
          resolve(err)
        })
      })
    }
    var ps = []
    for (var i = 0; i < 5; i++) {
      ps.push(runErrorQuery())
    }
    Promise.all(ps).then(function () {
      expect(shouldGet).to.eql(errors)
      pool.end(done)
    })
  })

  describe('calling release more than once', () => {
    it('should throw each time', co.wrap(function* () {
      const pool = new Pool()
      const client = yield pool.connect()
      client.release()
      expect(() => client.release()).to.throwError()
      expect(() => client.release()).to.throwError()
      return yield pool.end()
    }))
  })

  describe('calling connect after end', () => {
    it('should return an error', function * () {
      const pool = new Pool()
      const res = yield pool.query('SELECT $1::text as name', ['hi'])
      expect(res.rows[0].name).to.equal('hi')
      const wait = pool.end()
      pool.query('select now()')
      yield wait
      expect(() => pool.query('select now()')).to.reject()
    })
  })

  describe('using an ended pool', () => {
    it('rejects all additional promises', (done) => {
      const pool = new Pool()
      const errors = []
      const promises = []
      pool.end()
        .then(() => {
          const squash = promise => promise.catch(e => 'okay!')
          promises.push(squash(pool.connect()))
          promises.push(squash(pool.query('SELECT NOW()')))
          promises.push(squash(pool.end()))
          Promise.all(promises).then(res => {
            expect(res).to.eql(['okay!', 'okay!', 'okay!'])
            done()
          })
        })
    })

    it('returns an error on all additional callbacks', (done) => {
      const pool = new Pool()
      const errors = []
      pool.end(() => {
        pool.query('SELECT *', (err) => {
          expect(err).to.be.an(Error)
          pool.connect((err) => {
            expect(err).to.be.an(Error)
            pool.end((err) => {
              expect(err).to.be.an(Error)
              done()
            })
          })
        })
      })
    })
  })

  describe('error from idle client', () => {
    it('removes client from pool', co.wrap(function * () {
      const pool = new Pool()
      const client = yield pool.connect()
      expect(pool.totalCount).to.equal(1)
      expect(pool.waitingCount).to.equal(0)
      expect(pool.idleCount).to.equal(0)
      client.release()
      yield new Promise((resolve, reject) => {
        process.nextTick(() => {
          pool.once('error', (err) => {
            expect(err.message).to.equal('expected')
            expect(pool.idleCount).to.equal(0)
            expect(pool.totalCount).to.equal(0)
            pool.end().then(resolve, reject)
          })
          client.emit('error', new Error('expected'))
        })
      })
    }))
  })
})
