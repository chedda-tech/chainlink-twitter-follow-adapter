const { Requester, Validator } = require('@chainlink/external-adapter')

const bearerToken = process.env.BEARER_TOKEN

// Define custom error scenarios for the API.
// Return true for the adapter to retry.
const customError = (data) => {
  if (data.Response === 'Error') return true
  return false
}

// Define custom parameters to be used by the adapter.
// Extra parameters can be stated in the extra object,
// with a Boolean value indicating whether or not they
// should be required.
const customParams = {
  userId: ['u', 'uid', 'userId'],
  followerUsername: ['f', 'username', 'follower'],
  endpoint: false
}

const createRequest = (input, callback) => {
  // The Validator helps you validate the Chainlink request data
  const validator = new Validator(callback, input, customParams)
  const jobRunID = validator.validated.id

  const uid = validator.validated.data.userId
  const follower = validator.validated.data.followerUsername

  verifyTwitterFollow(uid, follower)
  .then(response => {
    response.data = {...response}
    response.data.result = response.verified
    response.status = 200
    callback(response.status, Requester.success(jobRunID, response))
  })
  .catch(error => {
    callback(500, Requester.errored(jobRunID, error))
  })
}

// loop through all Twitter followers of userId, looking for username
verifyTwitterFollow = async (userId, username) => {
  let nextToken = ''
  let found = false
  do {
    let response = await getTwitterFollowers(userId, nextToken)
    if (response.data) {
      const followers = response.data.data
      for (const f of followers) {
        if (f.username == username) {
          found = true
          break
        }
      }
      if (response.data.meta) {
        nextToken = response.data.meta.next_token
      }
    }
  } while (nextToken && !found);

  return {verified: found}
}

// Twitter v2 followers API returns a max of 1000 results. 
// If userId has > 1000 followers we have to keep looking till
// there is no next_token present in the response
getTwitterFollowers = async (userId, nextToken) => {
  let params = {
    max_results: 1000,
  }
  if (nextToken) {
    params['pagination_token'] = nextToken
  }

  const url = `https://api.twitter.com/2/users/${userId}/followers`
  const headers = {
    'Authorization': `Bearer ${bearerToken}`
  }
  const config = {
    url,
    params,
    headers
  }

  console.log('making request with config: ', config)
  return new Promise((resolve, reject) => {
    Requester.request(config, customError)
    .then(response => {
      resolve(response)
    })
    .catch(err => {
      console.error('request failed with error: ', err)
      reject(err)
    })
  })
}

// This is a wrapper to allow the function to work with
// GCP Functions
exports.gcpservice = (req, res) => {
  createRequest(req.body, (statusCode, data) => {
    res.status(statusCode).send(data)
  })
}

// This is a wrapper to allow the function to work with
// AWS Lambda
exports.handler = (event, context, callback) => {
  createRequest(event, (statusCode, data) => {
    callback(null, data)
  })
}

// This is a wrapper to allow the function to work with
// newer AWS Lambda implementations
exports.handlerv2 = (event, context, callback) => {
  createRequest(JSON.parse(event.body), (statusCode, data) => {
    callback(null, {
      statusCode: statusCode,
      body: JSON.stringify(data),
      isBase64Encoded: false
    })
  })
}

// This allows the function to be exported for testing
// or for running in express
module.exports.createRequest = createRequest
