// # Recline Backends
//
// Backends are connectors to backend data sources and stores
//
// Backends are implemented as Backbone models but this is just a
// convenience (they do not save or load themselves from any remote
// source)
this.recline = this.recline || {};
this.recline.Model = this.recline.Model || {};

(function($, my) {
  my.backends = {};

  // ## Backbone.sync
  //
  // Override Backbone.sync to hand off to sync function in relevant backend
  Backbone.sync = function(method, model, options) {
    return my.backends[model.backendConfig.type].sync(method, model, options);
  }

  // ## wrapInTimeout
  // 
  // Crude way to catch backend errors
  // Many of backends use JSONP and so will not get error messages and this is
  // a crude way to catch those errors.
  function wrapInTimeout(ourFunction) {
    var dfd = $.Deferred();
    var timeout = 5000;
    var timer = setTimeout(function() {
      dfd.reject({
        message: 'Request Error: Backend did not respond after ' + (timeout / 1000) + ' seconds'
      });
    }, timeout);
    ourFunction.done(function(arguments) {
        clearTimeout(timer);
        dfd.resolve(arguments);
      })
      .fail(function(arguments) {
        clearTimeout(timer);
        dfd.reject(arguments);
      })
      ;
    return dfd.promise();
  }

  // ## BackendMemory - uses in-memory data
  //
  // To use you should:
  // 
  // A. provide metadata as model data to the Dataset
  //
  // B. Set backendConfig on your dataset with attributes:
  //
  //   - type: 'memory'
  //   - data: hash with 2 keys:
  //
  //     * headers: list of header names/labels
  //     * rows: list of hashes, each hash being one row. A row *must* have an id attribute which is unique.
  //
  //  Example of data:
  // 
  //  <pre>
  //        {
  //            headers: ['x', 'y', 'z']
  //          , rows: [
  //              {id: 0, x: 1, y: 2, z: 3}
  //            , {id: 1, x: 2, y: 4, z: 6}
  //          ]
  //        };
  //  </pre>
  my.BackendMemory = Backbone.Model.extend({
      sync: function(method, model, options) {
        var self = this;
        if (method === "read") {
          var dfd = $.Deferred();
          if (model.__type__ == 'Dataset') {
            var dataset = model;
            dataset.set({
              headers: dataset.backendConfig.data.headers
            });
            dataset.docCount = dataset.backendConfig.data.rows.length;
            dfd.resolve(dataset);
          }
          return dfd.promise();
        } else if (method === 'update') {
          var dfd = $.Deferred();
          if (model.__type__ == 'Document') {
            _.each(model.backendConfig.data.rows, function(row, idx) {
              if(row.id === model.id) {
                model.backendConfig.data.rows[idx] = model.toJSON();
              }
            });
            dfd.resolve(model);
          }
          return dfd.promise();
        } else if (method === 'delete') {
          var dfd = $.Deferred();
          if (model.__type__ == 'Document') {
            model.backendConfig.data.rows = _.reject(model.backendConfig.data.rows, function(row) {
              return (row.id === model.id);
            });
            dfd.resolve(model);
          }
          return dfd.promise();
        } else {
          alert('Not supported: sync on BackendMemory with method ' + method + ' and model ' + model);
        }
      },
      query: function(model, queryObj) {
        var numRows = queryObj.size;
        var start = queryObj.offset;
        var dfd = $.Deferred();
        results = model.backendConfig.data.rows;
        // not complete sorting!
        _.each(queryObj.sort, function(item) {
          results = _.sortBy(results, function(row) {
            var _out = row[item[0]];
            return (item[1] == 'asc') ? _out : -1*_out;
          });
        });
        var results = results.slice(start, start+numRows);
        dfd.resolve(results);
        return dfd.promise();
      }
  });
  my.backends['memory'] = new my.BackendMemory();

  // ## BackendWebstore
  //
  // Connecting to [Webstores](http://github.com/okfn/webstore)
  //
  // To use this backend set backendConfig on your Dataset as:
  //
  // <pre>
  // {
  //   'type': 'webstore',
  //   'url': url to relevant Webstore table
  // }
  // </pre>
  my.BackendWebstore = Backbone.Model.extend({
    sync: function(method, model, options) {
      if (method === "read") {
        if (model.__type__ == 'Dataset') {
          var dataset = model;
          var base = dataset.backendConfig.url;
          var schemaUrl = base + '/schema.json';
          var jqxhr = $.ajax({
            url: schemaUrl,
              dataType: 'jsonp',
              jsonp: '_callback'
          });
          var dfd = $.Deferred();
          wrapInTimeout(jqxhr).done(function(schema) {
            headers = _.map(schema.data, function(item) {
              return item.name;
            });
            dataset.set({
              headers: headers
            });
            dataset.docCount = schema.count;
            dfd.resolve(dataset, jqxhr);
          })
          .fail(function(arguments) {
            dfd.reject(arguments);
          });
          return dfd.promise();
        }
      }
    },
    query: function(model, queryObj) {
      var base = model.backendConfig.url;
      var data = {
        _limit:  queryObj.size
        , _offset: queryObj.offset
      };
      var jqxhr = $.ajax({
        url: base + '.json',
        data: data,
        dataType: 'jsonp',
        jsonp: '_callback',
        cache: true
      });
      var dfd = $.Deferred();
      jqxhr.done(function(results) {
        dfd.resolve(results.data);
      });
      return dfd.promise();
    }
  });
  my.backends['webstore'] = new my.BackendWebstore();

  // ## BackendDataProxy
  // 
  // For connecting to [DataProxy-s](http://github.com/okfn/dataproxy).
  //
  // Set a Dataset to use this backend:
  //
  //     dataset.backendConfig = {
  //       // required
  //       url: {url-of-data-to-proxy},
  //       format: csv | xls,
  //     }
  //
  // When initializing the DataProxy backend you can set the following attributes:
  //
  // * dataproxy: {url-to-proxy} (optional). Defaults to http://jsonpdataproxy.appspot.com
  //
  // Note that this is a **read-only** backend.
  my.BackendDataProxy = Backbone.Model.extend({
    defaults: {
      dataproxy: 'http://jsonpdataproxy.appspot.com'
    },
    sync: function(method, model, options) {
      if (method === "read") {
        if (model.__type__ == 'Dataset') {
          var dataset = model;
          var base = my.backends['dataproxy'].get('dataproxy');
          // TODO: should we cache for extra efficiency
          var data = {
            url: dataset.backendConfig.url
            , 'max-results':  1
            , type: dataset.backendConfig.format
          };
          var jqxhr = $.ajax({
            url: base
            , data: data
            , dataType: 'jsonp'
          });
          var dfd = $.Deferred();
          wrapInTimeout(jqxhr).done(function(results) {
            dataset.set({
              headers: results.fields
            });
            dfd.resolve(dataset, jqxhr);
          })
          .fail(function(arguments) {
            dfd.reject(arguments);
          });
          return dfd.promise();
        }
      } else {
        alert('This backend only supports read operations');
      }
    },
    query: function(dataset, queryObj) {
      var base = my.backends['dataproxy'].get('dataproxy');
      var data = {
        url: dataset.backendConfig.url
        , 'max-results':  queryObj.size
        , type: dataset.backendConfig.format
      };
      var jqxhr = $.ajax({
        url: base
        , data: data
        , dataType: 'jsonp'
      });
      var dfd = $.Deferred();
      jqxhr.done(function(results) {
        var _out = _.map(results.data, function(row) {
          var tmp = {};
          _.each(results.fields, function(key, idx) {
            tmp[key] = row[idx];
          });
          return tmp;
        });
        dfd.resolve(_out);
      });
      return dfd.promise();
    }
  });
  my.backends['dataproxy'] = new my.BackendDataProxy();


  // ## Google spreadsheet backend
  // 
  // Connect to Google Docs spreadsheet. For write operations
  my.BackendGDoc = Backbone.Model.extend({
    sync: function(method, model, options) {
      if (method === "read") { 
        var dfd = $.Deferred(); 
        var dataset = model;

        $.getJSON(model.backendConfig.url, function(d) {
          result = my.backends['gdocs'].gdocsToJavascript(d);
          model.set({'headers': result.header});
          // cache data onto dataset (we have loaded whole gdoc it seems!)
          model._dataCache = result.data;
          dfd.resolve(model);
        })
        return dfd.promise(); }
    },

    query: function(dataset, queryObj) { 
      var dfd = $.Deferred();
      var fields = dataset.get('headers');

      // zip the field headers with the data rows to produce js objs
      // TODO: factor this out as a common method with other backends
      var objs = _.map(dataset._dataCache, function (d) { 
        var obj = {};
        _.each(_.zip(fields, d), function (x) { obj[x[0]] = x[1]; })
        return obj;
      });
      dfd.resolve(objs);
      return dfd;
    },
    gdocsToJavascript:  function(gdocsSpreadsheet) {
      /*
         :options: (optional) optional argument dictionary:
         columnsToUse: list of columns to use (specified by header names)
         colTypes: dictionary (with column names as keys) specifying types (e.g. range, percent for use in conversion).
         :return: tabular data object (hash with keys: header and data).

         Issues: seems google docs return columns in rows in random order and not even sure whether consistent across rows.
         */
      var options = {};
      if (arguments.length > 1) {
        options = arguments[1];
      }
      var results = {
        'header': [],
        'data': []
      };
      // default is no special info on type of columns
      var colTypes = {};
      if (options.colTypes) {
        colTypes = options.colTypes;
      }
      // either extract column headings from spreadsheet directly, or used supplied ones
      if (options.columnsToUse) {
        // columns set to subset supplied
        results.header = options.columnsToUse;
      } else {
        // set columns to use to be all available
        if (gdocsSpreadsheet.feed.entry.length > 0) {
          for (var k in gdocsSpreadsheet.feed.entry[0]) {
            if (k.substr(0, 3) == 'gsx') {
              var col = k.substr(4)
                results.header.push(col);
            }
          }
        }
      }

      // converts non numberical values that should be numerical (22.3%[string] -> 0.223[float])
      var rep = /^([\d\.\-]+)\%$/;
      $.each(gdocsSpreadsheet.feed.entry, function (i, entry) {
        var row = [];
        for (var k in results.header) {
          var col = results.header[k];
          var _keyname = 'gsx$' + col;
          var value = entry[_keyname]['$t'];
          // if labelled as % and value contains %, convert
          if (colTypes[col] == 'percent') {
            if (rep.test(value)) {
              var value2 = rep.exec(value);
              var value3 = parseFloat(value2);
              value = value3 / 100;
            }
          }
          row.push(value);
        }
        results.data.push(row);
      });
      return results;
    }
  });
  my.backends['gdocs'] = new my.BackendGDoc();

}(jQuery, this.recline.Model));
// importScripts('lib/underscore.js'); 

onmessage = function(message) {
  
  function parseCSV(rawCSV) {
    var patterns = new RegExp((
      // Delimiters.
      "(\\,|\\r?\\n|\\r|^)" +
      // Quoted fields.
      "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|" +
      // Standard fields.
      "([^\"\\,\\r\\n]*))"
    ), "gi");

    var rows = [[]], matches = null;

    while (matches = patterns.exec(rawCSV)) {
      var delimiter = matches[1];

      if (delimiter.length && (delimiter !== ",")) rows.push([]);

      if (matches[2]) {
        var value = matches[2].replace(new RegExp("\"\"", "g"), "\"");
      } else {
        var value = matches[3];
      }
      rows[rows.length - 1].push(value);
    }

    if(_.isEqual(rows[rows.length -1], [""])) rows.pop();

    var docs = [];
    var headers = _.first(rows);
    _.each(_.rest(rows), function(row, rowIDX) {
      var doc = {};
      _.each(row, function(cell, idx) {      
        doc[headers[idx]] = cell;
      })
      docs.push(doc);
    })

    return docs;
  }
  
  var docs = parseCSV(message.data.data);
  
  var req = new XMLHttpRequest();

  req.onprogress = req.upload.onprogress = function(e) {
    if(e.lengthComputable) postMessage({ percent: (e.loaded / e.total) * 100 });
  };
  
  req.onreadystatechange = function() { if (req.readyState == 4) postMessage({done: true, response: req.responseText}) };
  req.open('POST', message.data.url);
  req.setRequestHeader('Content-Type', 'application/json');
  req.send(JSON.stringify({docs: docs}));
};
// adapted from https://github.com/harthur/costco. heather rules

var costco = function() {
  
  function evalFunction(funcString) {
    try {
      eval("var editFunc = " + funcString);
    } catch(e) {
      return {errorMessage: e+""};
    }
    return editFunc;
  }
  
  function previewTransform(docs, editFunc, currentColumn) {
    var preview = [];
    var updated = mapDocs($.extend(true, {}, docs), editFunc);
    for (var i = 0; i < updated.docs.length; i++) {      
      var before = docs[i]
        , after = updated.docs[i]
        ;
      if (!after) after = {};
      if (currentColumn) {
        preview.push({before: JSON.stringify(before[currentColumn]), after: JSON.stringify(after[currentColumn])});      
      } else {
        preview.push({before: JSON.stringify(before), after: JSON.stringify(after)});      
      }
    }
    return preview;
  }

  function mapDocs(docs, editFunc) {
    var edited = []
      , deleted = []
      , failed = []
      ;
    
    var updatedDocs = _.map(docs, function(doc) {
      try {
        var updated = editFunc(_.clone(doc));
      } catch(e) {
        failed.push(doc);
        return;
      }
      if(updated === null) {
        updated = {_deleted: true};
        edited.push(updated);
        deleted.push(doc);
      }
      else if(updated && !_.isEqual(updated, doc)) {
        edited.push(updated);
      }
      return updated;      
    });
    
    return {
      edited: edited, 
      docs: updatedDocs, 
      deleted: deleted, 
      failed: failed
    };
  }
  
  return {
    evalFunction: evalFunction,
    previewTransform: previewTransform,
    mapDocs: mapDocs
  };
}();
// # Recline Backbone Models
this.recline = this.recline || {};
this.recline.Model = this.recline.Model || {};

(function($, my) {
  // ## A Dataset model
  //
  // Other than standard list of Backbone methods it has two important attributes:
  //
  // * currentDocuments: a DocumentList containing the Documents we have currently loaded for viewing (you update currentDocuments by calling getRows)
  // * docCount: total number of documents in this dataset (obtained on a fetch for this Dataset)
  my.Dataset = Backbone.Model.extend({
    __type__: 'Dataset',
    initialize: function(options) {
      this.currentDocuments = new my.DocumentList();
      this.docCount = null;
      this.backend = null;
      this.defaultQuery = {
        size: 100
        , offset: 0
      };
      // this.queryState = {};
    },

    // ### getDocuments
    //
    // AJAX method with promise API to get rows (documents) from the backend.
    //
    // Resulting DocumentList are used to reset this.currentDocuments and are
    // also returned.
    //
    // :param numRows: passed onto backend getDocuments.
    // :param start: passed onto backend getDocuments.
    //
    // this does not fit very well with Backbone setup. Backbone really expects you to know the ids of objects your are fetching (which you do in classic RESTful ajax-y world). But this paradigm does not fill well with data set up we have here.
    // This also illustrates the limitations of separating the Dataset and the Backend
    query: function(queryObj) {
      var self = this;
      var backend = my.backends[this.backendConfig.type];
      this.queryState = queryObj || this.defaultQuery;
      this.queryState = _.extend({size: 100, offset: 0}, this.queryState);
      var dfd = $.Deferred();
      backend.query(this, this.queryState).done(function(rows) {
        var docs = _.map(rows, function(row) {
          var _doc = new my.Document(row);
          _doc.backendConfig = self.backendConfig;
          _doc.backend = backend;
          return _doc;
        });
        self.currentDocuments.reset(docs);
        dfd.resolve(self.currentDocuments);
      })
      .fail(function(arguments) {
        dfd.reject(arguments);
      });
      return dfd.promise();
    },

    toTemplateJSON: function() {
      var data = this.toJSON();
      data.docCount = this.docCount;
      return data;
    }
  });

  // ## A Document (aka Row)
  // 
  // A single entry or row in the dataset
  my.Document = Backbone.Model.extend({
    __type__: 'Document'
  });

  // ## A Backbone collection of Documents
  my.DocumentList = Backbone.Collection.extend({
    __type__: 'DocumentList',
    model: my.Document
  });
}(jQuery, this.recline.Model));

var util = function() {
  var templates = {
    transformActions: '<li><a data-action="transform" class="menuAction" href="JavaScript:void(0);">Global transform...</a></li>'
    , columnActions: ' \
      <li class="write-op"><a data-action="bulkEdit" class="menuAction" href="JavaScript:void(0);">Transform...</a></li> \
      <li class="write-op"><a data-action="deleteColumn" class="menuAction" href="JavaScript:void(0);">Delete this column</a></li> \
      <li><a data-action="sortAsc" class="menuAction" href="JavaScript:void(0);">Sort ascending</a></li> \
      <li><a data-action="sortDesc" class="menuAction" href="JavaScript:void(0);">Sort descending</a></li> \
      <li><a data-action="hideColumn" class="menuAction" href="JavaScript:void(0);">Hide this column</a></li> \
    '
    , rowActions: '<li><a data-action="deleteRow" class="menuAction write-op" href="JavaScript:void(0);">Delete this row</a></li>'
    , rootActions: ' \
        {{#columns}} \
        <li><a data-action="showColumn" data-column="{{.}}" class="menuAction" href="JavaScript:void(0);">Add column: {{.}}</a></li> \
        {{/columns}}'
    , cellEditor: ' \
      <div class="menu-container data-table-cell-editor"> \
        <textarea class="data-table-cell-editor-editor" bind="textarea">{{value}}</textarea> \
        <div id="data-table-cell-editor-actions"> \
          <div class="data-table-cell-editor-action"> \
            <button class="okButton btn primary">Update</button> \
            <button class="cancelButton btn danger">Cancel</button> \
          </div> \
        </div> \
      </div> \
    '
    , editPreview: ' \
      <div class="expression-preview-table-wrapper"> \
        <table> \
        <thead> \
        <tr> \
          <th class="expression-preview-heading"> \
            before \
          </th> \
          <th class="expression-preview-heading"> \
            after \
          </th> \
        </tr> \
        </thead> \
        <tbody> \
        {{#rows}} \
        <tr> \
          <td class="expression-preview-value"> \
            {{before}} \
          </td> \
          <td class="expression-preview-value"> \
            {{after}} \
          </td> \
        </tr> \
        {{/rows}} \
        </tbody> \
        </table> \
      </div> \
    '
  };

  $.fn.serializeObject = function() {
    var o = {};
    var a = this.serializeArray();
    $.each(a, function() {
      if (o[this.name]) {
        if (!o[this.name].push) {
          o[this.name] = [o[this.name]];
        }
        o[this.name].push(this.value || '');
      } else {
        o[this.name] = this.value || '';
      }
    });
    return o;
  };

  function registerEmitter() {
    var Emitter = function(obj) {
      this.emit = function(obj, channel) { 
        if (!channel) var channel = 'data';
        this.trigger(channel, obj); 
      };
    };
    MicroEvent.mixin(Emitter);
    return new Emitter();
  }
  
  function listenFor(keys) {
    var shortcuts = { // from jquery.hotkeys.js
			8: "backspace", 9: "tab", 13: "return", 16: "shift", 17: "ctrl", 18: "alt", 19: "pause",
			20: "capslock", 27: "esc", 32: "space", 33: "pageup", 34: "pagedown", 35: "end", 36: "home",
			37: "left", 38: "up", 39: "right", 40: "down", 45: "insert", 46: "del", 
			96: "0", 97: "1", 98: "2", 99: "3", 100: "4", 101: "5", 102: "6", 103: "7",
			104: "8", 105: "9", 106: "*", 107: "+", 109: "-", 110: ".", 111 : "/", 
			112: "f1", 113: "f2", 114: "f3", 115: "f4", 116: "f5", 117: "f6", 118: "f7", 119: "f8", 
			120: "f9", 121: "f10", 122: "f11", 123: "f12", 144: "numlock", 145: "scroll", 191: "/", 224: "meta"
		}
    window.addEventListener("keyup", function(e) { 
      var pressed = shortcuts[e.keyCode];
      if(_.include(keys, pressed)) app.emitter.emit("keyup", pressed); 
    }, false);
  }
  
  function observeExit(elem, callback) {
    var cancelButton = elem.find('.cancelButton');
    // TODO: remove (commented out as part of Backbon-i-fication
    // app.emitter.on('esc', function() { 
    //  cancelButton.click();
    //  app.emitter.clear('esc');
    // });
    cancelButton.click(callback);
  }
  
  function show( thing ) {
    $('.' + thing ).show();
    $('.' + thing + '-overlay').show();
  }

  function hide( thing ) {
    $('.' + thing ).hide();
    $('.' + thing + '-overlay').hide();
    // TODO: remove or replace (commented out as part of Backbon-i-fication
    // if (thing === "dialog") app.emitter.clear('esc'); // todo more elegant solution
  }
  
  function position( thing, elem, offset ) {
    var position = $(elem.target).position();
    if (offset) {
      if (offset.top) position.top += offset.top;
      if (offset.left) position.left += offset.left;
    }
    $('.' + thing + '-overlay').show().click(function(e) {
      $(e.target).hide();
      $('.' + thing).hide();
    });
    $('.' + thing).show().css({top: position.top + $(elem.target).height(), left: position.left});
  }

  function render( template, target, options ) {
    if ( !options ) options = {data: {}};
    if ( !options.data ) options = {data: options};
    var html = $.mustache( templates[template], options.data );
    if (target instanceof jQuery) {
      var targetDom = target;
    } else {
      var targetDom = $( "." + target + ":first" );      
    }
    if( options.append ) {
      targetDom.append( html );
    } else {
      targetDom.html( html );
    }
    // TODO: remove (commented out as part of Backbon-i-fication
    // if (template in app.after) app.after[template]();
  }

  return {
    registerEmitter: registerEmitter,
    listenFor: listenFor,
    show: show,
    hide: hide,
    position: position,
    render: render,
    observeExit: observeExit
  };
}();
this.recline = this.recline || {};

// Views module following classic module pattern
recline.View = function($) {

var my = {};

// Parse a URL query string (?xyz=abc...) into a dictionary.
function parseQueryString(q) {
  var urlParams = {},
    e, d = function (s) {
      return unescape(s.replace(/\+/g, " "));
    },
    r = /([^&=]+)=?([^&]*)/g;

  if (q && q.length && q[0] === '?') {
    q = q.slice(1);
  }
  while (e = r.exec(q)) {
    // TODO: have values be array as query string allow repetition of keys
    urlParams[d(e[1])] = d(e[2]);
  }
  return urlParams;
}

// ## notify
//
// Create a notification (a div.alert-message in div.alert-messsages) using provide messages and options. Options are:
//
// * category: warning (default), success, error
// * persist: if true alert is persistent, o/w hidden after 3s (default = false)
// * loader: if true show loading spinner
my.notify = function(message, options) {
  if (!options) var options = {};
  var tmplData = _.extend({
    msg: message,
    category: 'warning'
    },
    options);
  var _template = ' \
    <div class="alert-message {{category}} fade in" data-alert="alert"><a class="close" href="#">×</a> \
      <p>{{msg}} \
        {{#loader}} \
        <img src="images/small-spinner.gif" class="notification-loader"> \
        {{/loader}} \
      </p> \
    </div>';
  var _templated = $.mustache(_template, tmplData); 
  _templated = $(_templated).appendTo($('.data-explorer .alert-messages'));
  if (!options.persist) {
    setTimeout(function() {
      $(_templated).fadeOut(1000, function() {
        $(this).remove();
      });
    }, 1000);
  }
}

// ## clearNotifications
//
// Clear all existing notifications
my.clearNotifications = function() {
  var $notifications = $('.data-explorer .alert-message');
  $notifications.remove();
}

// The primary view for the entire application.
//
// It should be initialized with a recline.Model.Dataset object and an existing
// dom element to attach to (the existing DOM element is important for
// rendering of FlotGraph subview).
// 
// To pass in configuration options use the config key in initialization hash
// e.g.
//
//      var explorer = new DataExplorer({
//        config: {...}
//      })
//
// Config options:
//
// * displayCount: how many documents to display initially (default: 10)
// * readOnly: true/false (default: false) value indicating whether to
//   operate in read-only mode (hiding all editing options).
//
// All other views as contained in this one.
my.DataExplorer = Backbone.View.extend({
  template: ' \
  <div class="data-explorer"> \
    <div class="alert-messages"></div> \
    \
    <div class="header"> \
      <ul class="navigation"> \
        <li class="active"><a href="#grid" class="btn">Grid</a> \
        <li><a href="#graph" class="btn">Graph</a></li> \
      </ul> \
      <div class="pagination"> \
        <form class="display-count"> \
          Showing 0 to <input name="displayCount" type="text" value="{{displayCount}}" title="Edit and hit enter to change the number of rows displayed" /> of  <span class="doc-count">{{docCount}}</span> \
        </form> \
      </div> \
    </div> \
    <div class="data-view-container"></div> \
    <div class="dialog-overlay" style="display: none; z-index: 101; ">&nbsp;</div> \
    <div class="dialog ui-draggable" style="display: none; z-index: 102; top: 101px; "> \
      <div class="dialog-frame" style="width: 700px; visibility: visible; "> \
        <div class="dialog-content dialog-border"></div> \
      </div> \
    </div> \
  </div> \
  ',

  events: {
    'submit form.display-count': 'onDisplayCountUpdate'
  },

  initialize: function(options) {
    var self = this;
    this.el = $(this.el);
    this.config = _.extend({
        displayCount: 50
        , readOnly: false
      },
      options.config);
    if (this.config.readOnly) {
      this.setReadOnly();
    }
    // Hash of 'page' views (i.e. those for whole page) keyed by page name
    this.pageViews = {
      grid: new my.DataTable({
          model: this.model
        })
      , graph: new my.FlotGraph({
          model: this.model
        })
    };
    // this must be called after pageViews are created
    this.render();

    this.router = new Backbone.Router();
    this.setupRouting();

    // retrieve basic data like headers etc
    // note this.model and dataset returned are the same
    this.model.fetch()
      .done(function(dataset) {
        self.el.find('.doc-count').text(self.model.docCount || 'Unknown');
        self.query();
      })
      .fail(function(error) {
        my.notify(error.message, {category: 'error', persist: true});
      });
  },

  query: function() {
    this.config.displayCount = parseInt(this.el.find('input[name="displayCount"]').val());
    var queryObj = {
      size: this.config.displayCount
    };
    my.notify('Loading data', {loader: true});
    this.model.query(queryObj)
      .done(function() {
        my.clearNotifications();
        my.notify('Data loaded', {category: 'success'});
      })
      .fail(function(error) {
        my.clearNotifications();
        my.notify(error.message, {category: 'error', persist: true});
      });
  },

  onDisplayCountUpdate: function(e) {
    e.preventDefault();
    this.query();
  },

  setReadOnly: function() {
    this.el.addClass('read-only');
  },

  render: function() {
    var tmplData = this.model.toTemplateJSON();
    tmplData.displayCount = this.config.displayCount;
    var template = $.mustache(this.template, tmplData);
    $(this.el).html(template);
    var $dataViewContainer = this.el.find('.data-view-container');
    _.each(this.pageViews, function(view, pageName) {
      $dataViewContainer.append(view.el)
    });
  },

  setupRouting: function() {
    var self = this;
    this.router.route('', 'grid', function() {
      self.updateNav('grid');
    });
    this.router.route(/grid(\?.*)?/, 'view', function(queryString) {
      self.updateNav('grid', queryString);
    });
    this.router.route(/graph(\?.*)?/, 'graph', function(queryString) {
      self.updateNav('graph', queryString);
      // we have to call here due to fact plot may not have been able to draw
      // if it was hidden until now - see comments in FlotGraph.redraw
      qsParsed = parseQueryString(queryString);
      if ('graph' in qsParsed) {
        var chartConfig = JSON.parse(qsParsed['graph']);
        _.extend(self.pageViews['graph'].chartConfig, chartConfig);
      }
      self.pageViews['graph'].redraw();
    });
  },

  updateNav: function(pageName, queryString) {
    this.el.find('.navigation li').removeClass('active');
    var $el = this.el.find('.navigation li a[href=#' + pageName + ']');
    $el.parent().addClass('active');
    // show the specific page
    _.each(this.pageViews, function(view, pageViewName) {
      if (pageViewName === pageName) {
        view.el.show();
      } else {
        view.el.hide();
      }
    });
  }
});

// DataTable provides a tabular view on a Dataset.
//
// Initialize it with a recline.Dataset object.
my.DataTable = Backbone.View.extend({
  tagName:  "div",
  className: "data-table-container",

  initialize: function() {
    var self = this;
    this.el = $(this.el);
    _.bindAll(this, 'render');
    this.model.currentDocuments.bind('add', this.render);
    this.model.currentDocuments.bind('reset', this.render);
    this.model.currentDocuments.bind('remove', this.render);
    this.state = {};
    this.hiddenHeaders = [];
  },

  events: {
    'click .column-header-menu': 'onColumnHeaderClick'
    , 'click .row-header-menu': 'onRowHeaderClick'
    , 'click .root-header-menu': 'onRootHeaderClick'
    , 'click .data-table-menu li a': 'onMenuClick'
  },

  // TODO: delete or re-enable (currently this code is not used from anywhere except deprecated or disabled methods (see above)).
  // showDialog: function(template, data) {
  //   if (!data) data = {};
  //   util.show('dialog');
  //   util.render(template, 'dialog-content', data);
  //   util.observeExit($('.dialog-content'), function() {
  //     util.hide('dialog');
  //   })
  //   $('.dialog').draggable({ handle: '.dialog-header', cursor: 'move' });
  // },


  // ======================================================
  // Column and row menus

  onColumnHeaderClick: function(e) {
    this.state.currentColumn = $(e.target).siblings().text();
    util.position('data-table-menu', e);
    util.render('columnActions', 'data-table-menu');
  },

  onRowHeaderClick: function(e) {
    this.state.currentRow = $(e.target).parents('tr:first').attr('data-id');
    util.position('data-table-menu', e);
    util.render('rowActions', 'data-table-menu');
  },
  
  onRootHeaderClick: function(e) {
    util.position('data-table-menu', e);
    util.render('rootActions', 'data-table-menu', {'columns': this.hiddenHeaders});
  },

  onMenuClick: function(e) {
    var self = this;
    e.preventDefault();
    var actions = {
      bulkEdit: function() { self.showTransformColumnDialog('bulkEdit', {name: self.state.currentColumn}) },
      transform: function() { self.showTransformDialog('transform') },
      sortAsc: function() { self.setColumnSort('asc') },
      sortDesc: function() { self.setColumnSort('desc') },
      hideColumn: function() { self.hideColumn() },
      showColumn: function() { self.showColumn(e) },
      // TODO: Delete or re-implement ...
      csv: function() { window.location.href = app.csvUrl },
      json: function() { window.location.href = "_rewrite/api/json" },
      urlImport: function() { showDialog('urlImport') },
      pasteImport: function() { showDialog('pasteImport') },
      uploadImport: function() { showDialog('uploadImport') },
      // END TODO
      deleteColumn: function() {
        var msg = "Are you sure? This will delete '" + self.state.currentColumn + "' from all documents.";
        // TODO:
        alert('This function needs to be re-implemented');
        return;
        if (confirm(msg)) costco.deleteColumn(self.state.currentColumn);
      },
      deleteRow: function() {
        var doc = _.find(self.model.currentDocuments.models, function(doc) {
          // important this is == as the currentRow will be string (as comes
          // from DOM) while id may be int
          return doc.id == self.state.currentRow
        });
        doc.destroy().then(function() { 
            self.model.currentDocuments.remove(doc);
            my.notify("Row deleted successfully");
          })
          .fail(function(err) {
            my.notify("Errorz! " + err)
          })
      }
    }
    util.hide('data-table-menu');
    actions[$(e.target).attr('data-action')]();
  },

  showTransformColumnDialog: function() {
    var $el = $('.dialog-content');
    util.show('dialog');
    var view = new my.ColumnTransform({
      model: this.model
    });
    view.state = this.state;
    view.render();
    $el.empty();
    $el.append(view.el);
    util.observeExit($el, function() {
      util.hide('dialog');
    })
    $('.dialog').draggable({ handle: '.dialog-header', cursor: 'move' });
  },

  showTransformDialog: function() {
    var $el = $('.dialog-content');
    util.show('dialog');
    var view = new my.DataTransform({
    });
    view.render();
    $el.empty();
    $el.append(view.el);
    util.observeExit($el, function() {
      util.hide('dialog');
    })
    $('.dialog').draggable({ handle: '.dialog-header', cursor: 'move' });
  },

  setColumnSort: function(order) {
    var query = _.extend(this.model.queryState, {sort: [[this.state.currentColumn, order]]});
    this.model.query(query);
  },
  
  hideColumn: function() {
    this.hiddenHeaders.push(this.state.currentColumn);
    this.render();
  },
  
  showColumn: function(e) {
    this.hiddenHeaders = _.without(this.hiddenHeaders, $(e.target).data('column'));
    this.render();
  },

  // ======================================================
  // Core Templating
  template: ' \
    <div class="data-table-menu-overlay" style="display: none; z-index: 101; ">&nbsp;</div> \
    <ul class="data-table-menu"></ul> \
    <table class="data-table" cellspacing="0"> \
      <thead> \
        <tr> \
          {{#notEmpty}} \
            <th class="column-header"> \
              <div class="column-header-title"> \
                <a class="root-header-menu"></a> \
                <span class="column-header-name"></span> \
              </div> \
            </th> \
          {{/notEmpty}} \
          {{#headers}} \
            <th class="column-header"> \
              <div class="column-header-title"> \
                <a class="column-header-menu"></a> \
                <span class="column-header-name">{{.}}</span> \
              </div> \
              </div> \
            </th> \
          {{/headers}} \
        </tr> \
      </thead> \
      <tbody></tbody> \
    </table> \
  ',

  toTemplateJSON: function() {
    var modelData = this.model.toJSON()
    modelData.notEmpty = ( this.headers.length > 0 )
    modelData.headers = this.headers;
    return modelData;
  },
  render: function() {
    var self = this;
    this.headers = _.filter(this.model.get('headers'), function(header) {
      return _.indexOf(self.hiddenHeaders, header) == -1;
    });
    var htmls = $.mustache(this.template, this.toTemplateJSON());
    this.el.html(htmls);
    this.model.currentDocuments.forEach(function(doc) {
      var tr = $('<tr />');
      self.el.find('tbody').append(tr);
      var newView = new my.DataTableRow({
          model: doc,
          el: tr,
          headers: self.headers,
        });
      newView.render();
    });
    $(".root-header-menu").toggle((self.hiddenHeaders.length > 0));
    return this;
  }
});

// DataTableRow View for rendering an individual document.
//
// Since we want this to update in place it is up to creator to provider the element to attach to.
// In addition you must pass in a headers in the constructor options. This should be list of headers for the DataTable.
my.DataTableRow = Backbone.View.extend({
  initialize: function(options) {
    _.bindAll(this, 'render');
    this._headers = options.headers;
    this.el = $(this.el);
    this.model.bind('change', this.render);
  },

  template: ' \
      <td><a class="row-header-menu"></a></td> \
      {{#cells}} \
      <td data-header="{{header}}"> \
        <div class="data-table-cell-content"> \
          <a href="javascript:{}" class="data-table-cell-edit" title="Edit this cell">&nbsp;</a> \
          <div class="data-table-cell-value">{{value}}</div> \
        </div> \
      </td> \
      {{/cells}} \
    ',
  events: {
    'click .data-table-cell-edit': 'onEditClick',
    // cell editor
    'click .data-table-cell-editor .okButton': 'onEditorOK',
    'click .data-table-cell-editor .cancelButton': 'onEditorCancel'
  },
  
  toTemplateJSON: function() {
    var doc = this.model;
    var cellData = _.map(this._headers, function(header) {
      return {header: header, value: doc.get(header)}
    })
    return { id: this.id, cells: cellData }
  },

  render: function() {
    this.el.attr('data-id', this.model.id);
    var html = $.mustache(this.template, this.toTemplateJSON());
    $(this.el).html(html);
    return this;
  },

  // ======================================================
  // Cell Editor

  onEditClick: function(e) {
    var editing = this.el.find('.data-table-cell-editor-editor');
    if (editing.length > 0) {
      editing.parents('.data-table-cell-value').html(editing.text()).siblings('.data-table-cell-edit').removeClass("hidden");
    }
    $(e.target).addClass("hidden");
    var cell = $(e.target).siblings('.data-table-cell-value');
    cell.data("previousContents", cell.text());
    util.render('cellEditor', cell, {value: cell.text()});
  },

  onEditorOK: function(e) {
    var cell = $(e.target);
    var rowId = cell.parents('tr').attr('data-id');
    var header = cell.parents('td').attr('data-header');
    var newValue = cell.parents('.data-table-cell-editor').find('.data-table-cell-editor-editor').val();
    var newData = {};
    newData[header] = newValue;
    this.model.set(newData);
    my.notify("Updating row...", {loader: true});
    this.model.save().then(function(response) {
        my.notify("Row updated successfully", {category: 'success'});
      })
      .fail(function() {
        my.notify('Error saving row', {
          category: 'error',
          persist: true
        });
      });
  },

  onEditorCancel: function(e) {
    var cell = $(e.target).parents('.data-table-cell-value');
    cell.html(cell.data('previousContents')).siblings('.data-table-cell-edit').removeClass("hidden");
  }
});


// View (Dialog) for doing data transformations (on columns of data).
my.ColumnTransform = Backbone.View.extend({
  className: 'transform-column-view',
  template: ' \
    <div class="dialog-header"> \
      Functional transform on column {{name}} \
    </div> \
    <div class="dialog-body"> \
      <div class="grid-layout layout-tight layout-full"> \
        <table> \
        <tbody> \
        <tr> \
          <td colspan="4"> \
            <div class="grid-layout layout-tight layout-full"> \
              <table rows="4" cols="4"> \
              <tbody> \
              <tr style="vertical-align: bottom;"> \
                <td colspan="4"> \
                  Expression \
                </td> \
              </tr> \
              <tr> \
                <td colspan="3"> \
                  <div class="input-container"> \
                    <textarea class="expression-preview-code"></textarea> \
                  </div> \
                </td> \
                <td class="expression-preview-parsing-status" width="150" style="vertical-align: top;"> \
                  No syntax error. \
                </td> \
              </tr> \
              <tr> \
                <td colspan="4"> \
                  <div id="expression-preview-tabs" class="refine-tabs ui-tabs ui-widget ui-widget-content ui-corner-all"> \
                    <span>Preview</span> \
                    <div id="expression-preview-tabs-preview" class="ui-tabs-panel ui-widget-content ui-corner-bottom"> \
                      <div class="expression-preview-container" style="width: 652px; "> \
                      </div> \
                    </div> \
                  </div> \
                </td> \
              </tr> \
              </tbody> \
              </table> \
            </div> \
          </td> \
        </tr> \
        </tbody> \
        </table> \
      </div> \
    </div> \
    <div class="dialog-footer"> \
      <button class="okButton btn primary">&nbsp;&nbsp;Update All&nbsp;&nbsp;</button> \
      <button class="cancelButton btn danger">Cancel</button> \
    </div> \
  ',

  events: {
    'click .okButton': 'onSubmit'
    , 'keydown .expression-preview-code': 'onEditorKeydown'
  },

  initialize: function() {
    this.el = $(this.el);
  },

  render: function() {
    var htmls = $.mustache(this.template, 
      {name: this.state.currentColumn}
      )
    this.el.html(htmls);
    // Put in the basic (identity) transform script
    // TODO: put this into the template?
    var editor = this.el.find('.expression-preview-code');
    editor.val("function(doc) {\n  doc['"+ this.state.currentColumn+"'] = doc['"+ this.state.currentColumn+"'];\n  return doc;\n}");
    editor.focus().get(0).setSelectionRange(18, 18);
    editor.keydown();
  },

  onSubmit: function(e) {
    var self = this;
    var funcText = this.el.find('.expression-preview-code').val();
    var editFunc = costco.evalFunction(funcText);
    if (editFunc.errorMessage) {
      my.notify("Error with function! " + editFunc.errorMessage);
      return;
    }
    util.hide('dialog');
    my.notify("Updating all visible docs. This could take a while...", {persist: true, loader: true});
      var docs = self.model.currentDocuments.map(function(doc) {
       return doc.toJSON();
      });
    // TODO: notify about failed docs? 
    var toUpdate = costco.mapDocs(docs, editFunc).edited;
    var totalToUpdate = toUpdate.length;
    function onCompletedUpdate() {
      totalToUpdate += -1;
      if (totalToUpdate === 0) {
        my.notify(toUpdate.length + " documents updated successfully");
        alert('WARNING: We have only updated the docs in this view. (Updating of all docs not yet implemented!)');
        self.remove();
      }
    }
    // TODO: Very inefficient as we search through all docs every time!
    _.each(toUpdate, function(editedDoc) {
      var realDoc = self.model.currentDocuments.get(editedDoc.id);
      realDoc.set(editedDoc);
      realDoc.save().then(onCompletedUpdate).fail(onCompletedUpdate)
    });
  },

  onEditorKeydown: function(e) {
    var self = this;
    // if you don't setTimeout it won't grab the latest character if you call e.target.value
    window.setTimeout( function() {
      var errors = self.el.find('.expression-preview-parsing-status');
      var editFunc = costco.evalFunction(e.target.value);
      if (!editFunc.errorMessage) {
        errors.text('No syntax error.');
        var docs = self.model.currentDocuments.map(function(doc) {
          return doc.toJSON();
        });
        var previewData = costco.previewTransform(docs, editFunc, self.state.currentColumn);
        util.render('editPreview', 'expression-preview-container', {rows: previewData});
      } else {
        errors.text(editFunc.errorMessage);
      }
    }, 1, true);
  }
});

// View (Dialog) for doing data transformations on whole dataset.
my.DataTransform = Backbone.View.extend({
  className: 'transform-view',
  template: ' \
    <div class="dialog-header"> \
      Recursive transform on all rows \
    </div> \
    <div class="dialog-body"> \
      <div class="grid-layout layout-full"> \
        <p class="info">Traverse and transform objects by visiting every node on a recursive walk using <a href="https://github.com/substack/js-traverse">js-traverse</a>.</p> \
        <table> \
        <tbody> \
        <tr> \
          <td colspan="4"> \
            <div class="grid-layout layout-tight layout-full"> \
              <table rows="4" cols="4"> \
              <tbody> \
              <tr style="vertical-align: bottom;"> \
                <td colspan="4"> \
                  Expression \
                </td> \
              </tr> \
              <tr> \
                <td colspan="3"> \
                  <div class="input-container"> \
                    <textarea class="expression-preview-code"></textarea> \
                  </div> \
                </td> \
                <td class="expression-preview-parsing-status" width="150" style="vertical-align: top;"> \
                  No syntax error. \
                </td> \
              </tr> \
              <tr> \
                <td colspan="4"> \
                  <div id="expression-preview-tabs" class="refine-tabs ui-tabs ui-widget ui-widget-content ui-corner-all"> \
                    <span>Preview</span> \
                    <div id="expression-preview-tabs-preview" class="ui-tabs-panel ui-widget-content ui-corner-bottom"> \
                      <div class="expression-preview-container" style="width: 652px; "> \
                      </div> \
                    </div> \
                  </div> \
                </td> \
              </tr> \
              </tbody> \
              </table> \
            </div> \
          </td> \
        </tr> \
        </tbody> \
        </table> \
      </div> \
    </div> \
    <div class="dialog-footer"> \
      <button class="okButton button">&nbsp;&nbsp;Update All&nbsp;&nbsp;</button> \
      <button class="cancelButton button">Cancel</button> \
    </div> \
  ',

  initialize: function() {
    this.el = $(this.el);
  },

  render: function() {
    this.el.html(this.template);
  }
});


// Graph view for a Dataset using Flot graphing library.
//
// Initialization arguments:
//
// * model: recline.Model.Dataset
// * config: (optional) graph configuration hash of form:
//
//        { 
//          group: {column name for x-axis},
//          series: [{column name for series A}, {column name series B}, ... ],
//          graphType: 'line'
//        }
//
// NB: should *not* provide an el argument to the view but must let the view
// generate the element itself (you can then append view.el to the DOM.
my.FlotGraph = Backbone.View.extend({

  tagName:  "div",
  className: "data-graph-container",

  template: ' \
  <div class="editor"> \
    <div class="editor-info editor-hide-info"> \
      <h3 class="action-toggle-help">Help &raquo;</h3> \
      <p>To create a chart select a column (group) to use as the x-axis \
         then another column (Series A) to plot against it.</p> \
      <p>You can add add \
         additional series by clicking the "Add series" button</p> \
    </div> \
    <form class="form-stacked"> \
      <div class="clearfix"> \
        <label>Graph Type</label> \
        <div class="input editor-type"> \
          <select> \
          <option value="line">Line</option> \
          </select> \
        </div> \
        <label>Group Column (x-axis)</label> \
        <div class="input editor-group"> \
          <select> \
          {{#headers}} \
          <option value="{{.}}">{{.}}</option> \
          {{/headers}} \
          </select> \
        </div> \
        <div class="editor-series-group"> \
          <div class="editor-series"> \
            <label>Series <span>A (y-axis)</span></label> \
            <div class="input"> \
              <select> \
              {{#headers}} \
              <option value="{{.}}">{{.}}</option> \
              {{/headers}} \
              </select> \
            </div> \
          </div> \
        </div> \
      </div> \
      <div class="editor-buttons"> \
        <button class="btn editor-add">Add Series</button> \
      </div> \
      <div class="editor-buttons editor-submit" comment="hidden temporarily" style="display: none;"> \
        <button class="editor-save">Save</button> \
        <input type="hidden" class="editor-id" value="chart-1" /> \
      </div> \
    </form> \
  </div> \
  <div class="panel graph"></div> \
</div> \
',

  events: {
    'change form select': 'onEditorSubmit'
    , 'click .editor-add': 'addSeries'
    , 'click .action-remove-series': 'removeSeries'
    , 'click .action-toggle-help': 'toggleHelp'
  },

  initialize: function(options, config) {
    var self = this;
    this.el = $(this.el);
    _.bindAll(this, 'render', 'redraw');
    // we need the model.headers to render properly
    this.model.bind('change', this.render);
    this.model.currentDocuments.bind('add', this.redraw);
    this.model.currentDocuments.bind('reset', this.redraw);
    this.chartConfig = _.extend({
        group: null,
        series: [],
        graphType: 'line'
      },
      config)
    this.render();
  },

  toTemplateJSON: function() {
    return this.model.toJSON();
  },

  render: function() {
    htmls = $.mustache(this.template, this.toTemplateJSON());
    $(this.el).html(htmls);
    // now set a load of stuff up
    this.$graph = this.el.find('.panel.graph');
    // for use later when adding additional series
    // could be simpler just to have a common template!
    this.$seriesClone = this.el.find('.editor-series').clone();
    this._updateSeries();
    return this;
  },

  onEditorSubmit: function(e) {
    var select = this.el.find('.editor-group select');
    this._getEditorData();
    // update navigation
    // TODO: make this less invasive (e.g. preserve other keys in query string)
    window.location.hash = window.location.hash.split('?')[0] +
        '?graph=' + JSON.stringify(this.chartConfig);
    this.redraw();
  },

  redraw: function() {
    // There appear to be issues generating a Flot graph if either:

    // * The relevant div that graph attaches to his hidden at the moment of creating the plot -- Flot will complain with
    //
    //   Uncaught Invalid dimensions for plot, width = 0, height = 0
    // * There is no data for the plot -- either same error or may have issues later with errors like 'non-existent node-value' 
    var areWeVisible = !jQuery.expr.filters.hidden(this.el[0]);
    if (!this.plot && (!areWeVisible || this.model.currentDocuments.length == 0)) {
      return
    }
    // create this.plot and cache it
    if (!this.plot) {
      // only lines for the present
      options = {
        id: 'line',
        name: 'Line Chart'
      };
      this.plot = $.plot(this.$graph, this.createSeries(), options);
    } 
    this.plot.setData(this.createSeries());
    this.plot.resize();
    this.plot.setupGrid();
    this.plot.draw();
  },

  _getEditorData: function() {
    $editor = this
    var series = this.$series.map(function () {
      return $(this).val();
    });
    this.chartConfig.series = $.makeArray(series)
    this.chartConfig.group = this.el.find('.editor-group select').val();
  },

  createSeries: function () {
    var self = this;
    var series = [];
    if (this.chartConfig) {
      $.each(this.chartConfig.series, function (seriesIndex, field) {
        var points = [];
        $.each(self.model.currentDocuments.models, function (index, doc) {
          var x = doc.get(self.chartConfig.group);
          var y = doc.get(field);
          if (typeof x === 'string') {
            x = index;
          }
          points.push([x, y]);
        });
        series.push({data: points, label: field});
      });
    }
    return series;
  },

  // Public: Adds a new empty series select box to the editor.
  //
  // All but the first select box will have a remove button that allows them
  // to be removed.
  //
  // Returns itself.
  addSeries: function (e) {
    e.preventDefault();
    var element = this.$seriesClone.clone(),
        label   = element.find('label'),
        index   = this.$series.length;

    this.el.find('.editor-series-group').append(element);
    this._updateSeries();
    label.append(' [<a href="#remove" class="action-remove-series">Remove</a>]');
    label.find('span').text(String.fromCharCode(this.$series.length + 64));
    return this;
  },

  // Public: Removes a series list item from the editor.
  //
  // Also updates the labels of the remaining series elements.
  removeSeries: function (e) {
    e.preventDefault();
    var $el = $(e.target);
    $el.parent().parent().remove();
    this._updateSeries();
    this.$series.each(function (index) {
      if (index > 0) {
        var labelSpan = $(this).prev().find('span');
        labelSpan.text(String.fromCharCode(index + 65));
      }
    });
    this.onEditorSubmit();
  },

  toggleHelp: function() {
    this.el.find('.editor-info').toggleClass('editor-hide-info');
  },

  // Private: Resets the series property to reference the select elements.
  //
  // Returns itself.
  _updateSeries: function () {
    this.$series  = this.el.find('.editor-series select');
  }
});

return my;

}(jQuery);
