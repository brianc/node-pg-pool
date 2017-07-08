'use strict'
const co = require('co')
const expect = require('expect.js')

const describe = require('mocha').describe
const it = require('mocha').it

const Pool = require('../')

describe('connection timeout', () => {
  it('should be a thing', false, () => {
    return Promise.reject(new Error('Should support idle timeout'))
  })
})

