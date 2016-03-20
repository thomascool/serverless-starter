/**
 * Lib
 */
process.env.TZ='America/Los_Angeles';

var async = require('async'),
  _ = require('underscore'),
  zlib = require('zlib'),
  config = require('config');

var json2csv = require('json2csv');
var request = require('request');
var AWS = require('aws-sdk');
AWS.config.region = 'us-west-2';

// Single - All
module.exports.singleAll = function(event, cb) {
// var singleAll = function(event, cb) {

async.map(config.get('stockList.full'), function(item, ecb) {
// async.each(["SVXY","UVXY","SPY","SPXL","SPLS","$SPX.X","$NDX.X","$RUT.X"], function(item, ecb) {
    var qQuote = require('./getOptionsQuote');
    var con;
    qQuote.getOptionsQuote(item, undefined, function(err, allData, stockTick) {
      var YYMMDD = (stockTick.createdDate.getFullYear().toString().substr(2,2) + '' + ('0'+(stockTick.createdDate.getMonth()+1)).slice(-2) + '' + ('0'+(stockTick.createdDate.getDate())).slice(-2));

      if (err) {
        ecb(err);
      } else {
        async.parallel([
            function(callback){
              var s3bucket = new AWS.S3({params: {Bucket: 'greekdata'}});
              s3bucket.createBucket(function() {
                json2csv({ data: stockTick, fields: _.keys(stockTick), del: '|' }, function(err, psv) {
                  if (err) callback(err);
                  s3bucket.upload({Key: 'stocks/'+stockTick.symbol+'/'+YYMMDD+'/'+stockTick.timeStamp+'.psv', Body: psv}, function(err, data) {
                    if (err) callback(err);
                    else callback(null, 'stocks/'+stockTick.symbol+'/'+YYMMDD+'/'+stockTick.timeStamp+'.psv');
                  });
                });
              });
            },
            function(callback){
              var s3bucket = new AWS.S3({params: {Bucket: 'greekdata'}});
              s3bucket.createBucket(function() {
                json2csv({ data: _.toArray(allData), fields: _.keys(_.toArray(allData)[0]), del: '|' }, function(err, psv) {
                  if (err) callback(err);
                  zlib.gzip(psv, function (_, result) {
                    s3bucket.upload({Key: 'options/'+stockTick.symbol+'/'+YYMMDD+'/'+stockTick.timeStamp+'.psv.gz', Body: result}, function(err, data) {
                      if (err) callback(err);
                      else callback(null, 'options/'+stockTick.symbol+'/'+YYMMDD+'/'+stockTick.timeStamp+'.psv.gz');
                    });
                  });
                });
              });
            }
          ],
          function(err, results){
            if (err)
              console.log('ERR: ', err)
            return ecb(null, results);
          });
      }
    });
  }, function(err, data) {
    if (err)
      return cb(null, 'bigbig problems : '+ err);
    else return cb(null, data);
  });

};

// Multi - Create
module.exports.multiCreate = function(event, cb) {

  var response = {
    message: 'Your Serverless function \'multi/create\' ran successfully!'
  };

  return cb(null, response);
};

// Multi - Show
module.exports.multiShow = function(event, cb) {

  var response = {
    message: 'Your Serverless function \'multi/show\' ran successfully with the following ID \'' + event.pathId + '\'!'
  };

  return cb(null, response);
};

/*
var testme = function() {

singleAll('whatever', function(err, rtn){
  console.log(err);
  console.log(rtn);
});

};

testme();
*/