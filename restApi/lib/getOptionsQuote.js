var request = require('request'),
  fs = require('fs'),
  zlib = require('zlib'),
  async = require('async'),
  _ = require('underscore'),
  cheerio = require('cheerio'),
  config = require('config'),
  AWS = require('aws-sdk');
AWS.config.region = 'us-west-2';

var headers = config.get('webRequest.headers')
var dt = new Date();
var YYMMDD = (dt.getFullYear().toString().substr(2,2) + '' + ('0'+(dt.getMonth()+1)).slice(-2) + '' + ('0'+(dt.getDate())).slice(-2));


var greeksAnalytical= function(action, symbol) {
  return {
    symbol: symbol,
    action: action,
    url: config.get('webRequest.url') + "?pagehandler=PHAnalyticalOptionChain&source=&symbol="+symbol+"&type=A&range=ALL&expire=A&strike=&action=Y&call_or_put="+action+"#",
    headers: headers
  }
}

var optionsPrice = function(symbol) {
  return {
    symbol: symbol,
    url: config.get('webRequest.url') + "?symbol=" + symbol + "&leg=symbol&type=CP&range=ALL&expire=AL&tabid=0",
    headers: headers
  }
}

var requestWithEncoding = function(optionsVal, callback) {
  var req = request.get(optionsVal);

  req.on('response', function(res) {
    var chunks = [];
    res.on('data', function(chunk) {
      chunks.push(chunk);
    });

    res.on('end', function() {
      var buffer = Buffer.concat(chunks);
      var encoding = res.headers['content-encoding'];
      if (encoding == 'gzip') {
        zlib.gunzip(buffer, function(err, decoded) {
          callback(err, decoded && decoded.toString());
        });
      } else if (encoding == 'deflate') {
        zlib.inflate(buffer, function(err, decoded) {
          callback(err, decoded && decoded.toString());
        })
      } else {
        callback(null, buffer.toString());
      }
    });
  });

  req.on('error', function(err) {
    callback(err);
  });
}

exports.requestURL = requestWithEncoding;

var requestFile = function(fullpath, callback) {
  fs.readFile(fullpath, function (err, data) {
    if (err) throw err;
    callback(err, data);
  });
}

var greeksExtraction = function(options, fullpath, callback) {
  var requestCall;
  if (typeof fullpath == 'undefined') {
    requestCall = requestWithEncoding;
  } else {
    requestCall = requestFile;
  }
  requestCall((typeof fullpath == 'undefined') ? options : fullpath, function(err, data) {
    if (err) callback(err);
    else {
      var $ = cheerio.load(data);

      var header = [], rtnData = [];
      $('table.underlyingTable').children().eq(1).children().each(function(i, element){
        var val = $(this).text()
        if (val !== '')
          header.push( (val==='--') ? null :  val.replace(",","") );
      });

      if (header.length == 0) {
        console.log('User account have been timeout!');
        process.exit(2);
      }

      if ('saveHTML_old' == 1) {
        fs.writeFile('./html/'+options.symbol+'~'+options.action+'^'+dt.getTime()+'.html', data, function (err) {
          if (err) throw err;
          console.log('Saved original HTML file: ' + options.symbol+'~'+options.action+'^'+dt.getTime()+'.html');
        });
      }
      if (config.get('saveHTML') == 1) {
        _.once(zlib.gzip(data, function (_, result) {  // The callback will give you the
          var s3bucket = new AWS.S3({params: {Bucket: 'greekdata'}});
          s3bucket.createBucket(function() {
            s3bucket.upload({Key: 'html/'+YYMMDD+'/'+ options.symbol+'~'+options.action+'^'+dt.getTime()+'.html.gz', Body: result}, function(err, data) {
              if (err) throw err;
              console.log('Saved original HTML file: ' + options.symbol+'~'+options.action+'^'+dt.getTime()+'.html');
            });
          });
        }));
      }

      var realtime = header[header.length - 1].split(" ");
      realtime.pop();
      var createDate = new Date( realtime.join(" ") + " GMT-0400 (PST)" ) ;
      var timeStamp = new Date( realtime.join(" ") + " GMT-0400 (PST)" ).getTime();

      var stocktick = {
        symbol : header[0].replace("$","").replace(".","_"),
        bid : header[1],
        ask : header[2],
        last : header[3],
        change : header[4],
        BAsize : header[6],
        high : header[7],
        low : header[8],
        volume : header[9],
        createdDate : createDate,
        timeStamp : timeStamp
      };
      if (config.get('debug') == 1) console.log('~define greeksExtraction stocktick:', stocktick );

      var lastHeader;

      $('table.t0').children().each(function(i, element){
        if (i > 0) {
          var row = [];
          var key;
          $(this).children().each(function(i, elem) {
            var val = $(this).text()
            if (val.length > 14) {
              var $$ = cheerio.load($(elem).html());
              key = $$('a').attr('onclick').split("','")[2];
              if (config.get('debug') == 1) console.log('XXXX2',     $$('a').attr('onclick').split("','")[2] );
            }
            if (val !== '' && val !== ' ')
              row.push( (val==='--') ? null :  val.replace(",","") );
          });
          if (config.get('debug') == 1) console.log( i, row );

          // create contract date format from 'Feb 27 2015' to '20150227' from data element 'AAPL (Mini) Jul 17 2015 165 Call'
          var title = row[1].replace("$","");
          var tmpDate = row[1].split(" ");
          if (tmpDate.length == 7) tmpDate.splice(1, 1);
          var tmpDate2 = new Date(tmpDate[1]+ ' ' + tmpDate[2]+ ' ' + tmpDate[3]);
          var contractDate = (tmpDate2.getFullYear() + '' + ('0'+(tmpDate2.getMonth()+1)).slice(-2) + '' + ('0'+(tmpDate2.getDate())).slice(-2));
          if (config.get('debug') == 1) console.log( contractDate );

          var action = 0
          if (tmpDate[tmpDate.length-1] == 'Call') {
            action = 1;
          }
          if (tmpDate[tmpDate.length-1] == 'Put') {
            action = 2;
          }
          var tmpData = {contract : key, title : title , createdDate : stocktick.createdDate, timeStamp : stocktick.timeStamp, action : action, strike: row[0] , bid: row[2], ask: row[3], IV: row[4], Theo: row[5], Delta: row[6], Gamma: row[7], Theta:row[8], Vega:row[9], Rho:row[10] };

          rtnData.push(tmpData);
        }
      });
      callback(null, rtnData, stocktick);
    }
  });
};

var optionExtraction = function(options, fullpath, callback) {
  var requestCall;
  if (typeof fullpath == 'undefined') {
    requestCall = requestWithEncoding;
  } else {
    requestCall = requestFile;
  }
  requestCall((typeof fullpath == 'undefined') ? options : fullpath, function(err, data) {
    if (err) console.log(err);
    else {
      var header = [], rtnData = [];
      var $ = cheerio.load(data);
      if ('saveHTML_old' == 1) {
        fs.writeFile('./html/'+options.symbol+'^'+dt.getTime()+'.html', data, function (err) {
          if (err) throw err;
          console.log('Saved original HTML CallPut file: ' + options.symbol+'^'+dt.getTime());
        });
      }
      if (config.get('saveHTML') == 1) {
        _.once(zlib.gzip(data, function (_, result) {  // The callback will give you the
          var s3bucket = new AWS.S3({params: {Bucket: 'greekdata'}});
          s3bucket.createBucket(function() {
            s3bucket.upload({Key: 'html/'+YYMMDD+'/'+ options.symbol+'^'+dt.getTime()+'.html.gz', Body: result}, function(err, data) {
              if (err) throw err;
              console.log('Saved original HTML CallPut file: ' + options.symbol+'^'+dt.getTime());
            });
          });
        }));
      }

      $('tr.altrows').children().each(function(i, element){
        var val = $(this).text()
        if (val !== '')
          header.push( (val==='--') ? null :  val.replace(",","") );
      });

      var realtime = header[header.length - 1].split(" ");
      realtime.pop();
      var createDate = new Date( realtime.join(" ") + " GMT-0500 (PST)" ) ;
      var timeStamp = new Date( realtime.join(" ") + " GMT-0500 (PST)" ).getTime();

      var stocktick = {
        symbol : header[0].replace("$","").replace(".","_"),
        bid : header[1],
        ask : header[2],
        last : header[3],
        change : header[4],
        BAsize : header[6],
        high : header[7],
        low : header[8],
        volume : header[9],
        createdDate : createDate,
        timeStamp : timeStamp
      };
      if (config.get('debug') == 1) console.log('optionExtraction stocktick:', stocktick );

      var lastHeader;
      $('tr.header.greyBG').parent().children().each(function(i, element){
        if (i > 0) {
          var $$ = cheerio.load($(this).children().next().html());
          var tmpDate, key;

          if (typeof $$('a').attr('id') == 'undefined') {
            tmpDate = lastHeader;
          } else {
            tmpDate = $$('a').attr('id').split(" ");
            lastHeader = tmpDate;
          }

          // remove the 'Weekly' word, could be others
          if (tmpDate.length > 6) tmpDate.splice(1, 1);
          var tmpDate2 = new Date(tmpDate[1]+ ' ' + tmpDate[2]+ ' ' + tmpDate[3]);
          var contractDate = (tmpDate2.getFullYear() + '' + ('0'+(tmpDate2.getMonth()+1)).slice(-2) + '' + ('0'+(tmpDate2.getDate())).slice(-2));
          var row = []
          $(this).children().each(function(i, elem) {
            var val = $(this).text()


            if (i == 1) {
              var $$ = cheerio.load($(elem).html());
              if ($$('a').attr('onclick'))
                key = $$('a').attr('onclick').split("','")[2];
            }
            if (val !== '' && val !== ' ')
              row.push( (val==='--') ? null :  val.replace(",","") );
          });

          if ((row.length > 6) && (row[0].split(" ")[1] !== '')) {
            var strike = row[0].split(" ")[0];
            var action = 0;
            if (row[0].split(" ")[1] == 'Call') {
              action = 1;
            }
            if (row[0].split(" ")[1] == 'Put') {
              action = 2;
            }
            var tmpData = {contract : key , createdDate : stocktick.createdDate, timeStamp : stocktick.timeStamp, action : action, strike: strike , bid: row[1], ask: row[2], last: row[3], change: row[4], vol: row[5], opInt:row[6]};

            rtnData.push(tmpData);
            if (config.get('debug') == 1) console.log( tmpData  );

          }
        }
      });
      callback(null, rtnData, stocktick);
    }

  });
};


exports.webRequest = function(newSymbol, filenames, callback) {
  async.parallel({
      CallGreeks : function(cb) {
        // Reset the stocktick for the new collection name
        // get the Call data first with saving it
        var filename;
        if (typeof filenames !== 'undefined') {
          var pathName;
          pathName = _.filter(filenames, function(item) {
            return item.fname == newSymbol + '~C';
          });
          if (pathName.length == 1) {
            filename = pathName[0].fullpath;
          }
          else {
            callback('Call data file not found!');
          }
        }
        greeksExtraction(greeksAnalytical('C', newSymbol), filename, function(err, data, tick) {
          if (err) cb(err);
          else {
            cb(null, {data:data, tick:tick});
          };
        });
      },
      PutGreeks : function(cb) {
// get the Put data second
        var filename;
        if (typeof filenames !== 'undefined') {
          var pathName;
          pathName = _.filter(filenames, function(item) {
            return item.fname == newSymbol + '~P';
          });
          if (pathName.length == 1) {
            filename = pathName[0].fullpath;
          }
          else {
            callback('Put data file not found!');
          }
        }
        greeksExtraction(greeksAnalytical('P', newSymbol), filename, function(err, data, tick) {
          if (err) cb(err);
          else {
            cb(null, {data:data, tick:tick});
          };
        });
      },
      CallPut : function(cb) {
        var filename;
        if (typeof filenames !== 'undefined') {
          var pathName;
          pathName = _.filter(filenames, function(item) {
            return item.fname == newSymbol;
          });
          if (pathName.length == 1) {
            filename = pathName[0].fullpath;
          }
          else {
            callback('CallPut data file not found!');
          }
        }
        optionExtraction(optionsPrice(newSymbol), filename, function(err, data, tick) {
          if (err) cb(err);
          else {
            cb(null, {data:data, tick:tick});
          };
        });
      }
    },
    function(err, results) {
      console.log('HTML parsing completed ', newSymbol);
      if (err) {
        console.log(err);
        callback(err, {}, {});
      } else {
        var dataSet = {}, finalTick;
        finalTick = results.PutGreeks.tick;
        _.map(results.CallGreeks.data, function(item) {
          if (dataSet[item.contract]) {
            dataSet[item.contract].Call = item.Call;
          } else {
            dataSet[item.contract] = item;
          }
        });
        _.map(results.PutGreeks.data, function(item) {
          if (dataSet[item.contract]) {
            dataSet[item.contract].Put = item.Put;
          } else {
            dataSet[item.contract] = item;
          }
        });
        _.map(results.CallPut.data, function(item) {
          var key = item.contract;
          if (dataSet[key]) {
            dataSet[key].createdDate = finalTick.createdDate;
            dataSet[key].timeStamp = finalTick.timeStamp;
            dataSet[key].last = item.last;
            dataSet[key].change = item.change;
            dataSet[key].vol = item.vol;
            dataSet[key].opInt = item.opInt;
          };
        });

        callback(err, dataSet, finalTick);
      }

    });
}




