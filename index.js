const express = require('express');
const port = process.env.PORT || 9000;

let bot = require('./bot');
let app = express();

app.get('/', (req, res) => { res.send('Yup, I`m here!'); });

app.listen(port, err => {
  if (err) throw err;
  console.log('Listening on port', port);
});