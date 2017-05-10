'use strict';

var Bot = require('slackbots'),
    assert = require('assert'),
    dotenv = require('dotenv'),
    fetch = require('node-fetch'),
    pgp = require('pg-promise')(),
    connectionString = process.env.DATABASE_URL,
    db = null,
    now = new Date();

// Default to search last week
var DEFAULT_FROM_DATE = (new Date()).setDate(now.getDate() - 7);

dotenv.load({silent: true});

assert(process.env.SLACK_TOKEN, 'missing SLACK_TOKEN in env');
assert(process.env.SLACK_NAME, 'missing SLACK_NAME in env');
assert(process.env.SLACK_CHANNEL, 'missing SLACK_CHANNEL in env');
assert(process.env.STACK_OVERFLOW_QUERY, 'missing STACK_OVERFLOW_QUERY in env');
assert(process.env.STACK_OVERFLOW_API_KEY, 'missing STACK_OVERFLOW_API_KEY in env');
assert(process.env.REFRESH_RATE_SECONDS >= 120, 'REFRESH_RATE_SECONDS must be >= 60');

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
        console.log('Last known question date', date);
        self.lastKnownQuestionDate = date;
        self.bot = new Bot({token: process.env.SLACK_TOKEN, name: process.env.SLACK_NAME});
      })
      .then(function() {
        self.start();
      });    

  }

  getLastKnownQuestionDate() {
    return db.one('select timestamp from lastKnownQuestion')
      .then(function(row) {return row.timestamp})
      .catch(function(err) {
        console.log('No last known question');
        return null;
      });
  }

  updateLastKnownQuestion(id, date) {
    return db.any('select * from lastKnownQuestion')
      .then(function(rows) {
        if (rows && rows.length) {
          console.log('Update lastKnownQuestion', id, date);
          return db.none('update lastKnownQuestion set id = $1, timestamp = $2', [id, date]);
        }
        // No entries yet so insert
        console.log('Insert lastKnownQuestion', id, date);
        return db.none('insert into lastKnownQuestion(id, timestamp) values ($1, $2)', [id, date])
          .then(function() {
            console.log('Inserted lastKnownQuestion', id, date);
          });
      });
  }

  start () {
    this.poll();
    if (!process.env.RUN_ONCE) {
      this.bot.on('start', () => {
        setInterval(this.poll.bind(this), process.env.REFRESH_RATE_SECONDS * 1000);
      });
    }
  }

  getFromDate() {
    var lastDate = this.lastKnownQuestionDate; 
    // Start from 1 second later than last known question date
    return lastDate ? (new Date(lastDate)).setSeconds(lastDate.getSeconds() + 1) : DEFAULT_FROM_DATE;
  }

  poll () {
    var url = API_URL
      .replace('{key}', encodeURIComponent(process.env.STACK_OVERFLOW_API_KEY))
      .replace('{query}', encodeURIComponent(process.env.STACK_OVERFLOW_QUERY))
      .replace('{fromdate}', Math.floor(this.getFromDate() / 1000));

    console.log('Polling...', API_URL);

    var self = this;

    fetch(url)
      .then((res) => res.json())
      .then((json) => {
        console.log('JSON response from Stack Overflow:', json);
        json.items.forEach(this.post.bind(this));
      })
      .then(() => {
        if (this.lastKnownQuestionId) {
          console.log('Updating DB with last known question', this.lastKnownQuestionId, this.lastKnownQuestionDate);
          return self.updateLastKnownQuestion(this.lastKnownQuestionId, this.lastKnownQuestionDate);
        }
      });
  }

  post (question) {
    console.log('Posting question', question.question_id);
    
    var creationDate = new Date(question.creation_date * 1000);

    console.log('creationDate', creationDate);

    if (creationDate > this.lastKnownQuestionDate) {
      this.lastKnownQuestionDate = creationDate;
      this.lastKnownQuestionId = question.question_id;
      console.log('Last known question', this.lastKnownQuestionDate, this.lastKnownQuestionId);
    }

    if (this.bot) {
      // TEMP commented out
      //this.bot.postMessageToChannel(process.env.SLACK_CHANNEL, question.link, {unfurl_links: true});
    } else {
      console.log(question);
    }
  }
}

new StackOverflowFeedBot();
