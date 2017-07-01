const crash = reason => {
  process.on(reason, err => {
    console.error(err.message, err.stack)
    process.exit(-1)
  })
}

crash('unhandledRejection')
crash('uncaughtError')
crash('warning')
