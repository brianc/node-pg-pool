
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
})
