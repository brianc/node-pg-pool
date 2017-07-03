'use strict'
const co = require('co')
const expect = require('expect.js')

const describe = require('mocha').describe
const it = require('mocha').it

const Pool = require('../')


describe('idle timeout', () => {
  it('should be a thing', () => {
    return Promise.reject(new Error('Should support idle timeout'))
  })
})
