'use strict';

var Bot = require('slackbots'),
    assert = require('assert'),
    dotenv = require('dotenv'),
    fetch = require('node-fetch'),
    pgp = require('pg-promise')(),
    connectionString = process.env.DATABASE_URL,
    db = null,
    now = new Date();

// Default to search last 24 hours
var DEFAULT_FROM_DATE = (new Date()).setDate(now.getDate() - 1);

dotenv.load({silent: true});

assert(process.env.SLACK_TOKEN, 'missing SLACK_TOKEN in env');
assert(process.env.SLACK_NAME, 'missing SLACK_NAME in env');
assert(process.env.SLACK_CHANNEL, 'missing SLACK_CHANNEL in env');
assert(process.env.STACK_OVERFLOW_QUERY, 'missing STACK_OVERFLOW_QUERY in env');
assert(process.env.STACK_OVERFLOW_API_KEY, 'missing STACK_OVERFLOW_API_KEY in env');
assert(process.env.REFRESH_RATE_SECONDS >= 60, 'REFRESH_RATE_SECONDS must be >= 60');

var API_URL = 'https://api.stackexchange.com'
  + '/2.2/search/advanced'
  + '?site=stackoverflow'
  + '&order=desc'
  + '&sort=creation'
  + '&key={key}'
  + '&q={query}'
  + '&fromdate={fromdate}';

class StackOverflowFeedBot {
  constructor () {

    db = pgp(process.env.DATABASE_URL);

    var self = this;

    // Get last update time from database to search from, otherwise use default
    this.getLastKnownQuestionDate()
      .then(function(date) {
        var fromDate = date || DEFAULT_FROM_DATE;
        console.log('Using last update date:', date);
        console.log('fromDate', fromDate);
        self.fromDate = Math.floor(fromDate / 1000);
        self.bot = new Bot({token: process.env.SLACK_TOKEN, name: process.env.SLACK_NAME});
      })
      .then(function() {
        self.start();
      });    

  }

  getLastKnownQuestionDate() {
    return db.one('select date from lastKnownQuestion')
      .catch(function(err) {
        console.log('No last known question', err);
        return null;
      });
  }

  updateLastKnownQuestionDate(date) {
    return db.one('update lastKnownQuestion set date = $1', [date]);
  }

  start () {
    if (process.env.RUN_ONCE) {
      this.poll();
    } else {
      this.bot.on('start', () => {
        setInterval(this.poll.bind(this), process.env.REFRESH_RATE_SECONDS * 1000);
      });
    }
  }

  poll () {
    var url = API_URL
      .replace('{key}', encodeURIComponent(process.env.STACK_OVERFLOW_API_KEY))
      .replace('{query}', encodeURIComponent(process.env.STACK_OVERFLOW_QUERY))
      .replace('{fromdate}', this.fromDate);

    console.log('Polling...', API_URL);

    var self = this;

    fetch(url)
      .then((res) => res.json())
      .then((json) => {
        console.log('JSON response from Stack Overflow:', json);
        json.items.forEach(this.post.bind(this));
      })
      .then(() => {
        console.log('Updating last known question date', this.fromDate);
        return self.updateLastKnownQuestionDate(this.fromDate);
      });
  }

  post (question) {
    console.log('Posting question', question.link);
    this.fromDate = Math.max(this.fromDate, question.creation_date + 1);
    if (this.bot) {
      this.bot.postMessageToChannel(process.env.SLACK_CHANNEL, question.link, {unfurl_links: true});
    } else {
      console.log(question);
    }
  }
}

new StackOverflowFeedBot();
