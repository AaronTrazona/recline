this.recline = this.recline || {};
this.recline.Backend = this.recline.Backend || {};

(function($, my) {
  // ## createDataset
  //
  // Convenience function to create a simple 'in-memory' dataset in one step.
  //
  // @param data: list of hashes for each document/row in the data ({key:
  // value, key: value})
  // @param fields: (optional) list of field hashes (each hash defining a hash
  // as per recline.Model.Field). If fields not specified they will be taken
  // from the data.
  // @param metadata: (optional) dataset metadata - see recline.Model.Dataset.
  // If not defined (or id not provided) id will be autogenerated.
  my.createDataset = function(data, fields, metadata) {
    if (!metadata) {
      metadata = {};
    }
    if (!metadata.id) {
      metadata.id = String(Math.floor(Math.random() * 100000000) + 1);
    }
    var backend = new recline.Backend.Memory();
    var datasetInfo = {
      documents: data,
      metadata: metadata
    };
    if (fields) {
      datasetInfo.fields = fields;
    } else {
      if (data) {
        datasetInfo.fields = _.map(data[0], function(value, key) {
          return {id: key};
        });
      }
    }
    backend.addDataset(datasetInfo);
    var dataset = new recline.Model.Dataset({id: metadata.id}, backend);
    dataset.fetch();
    return dataset;
  };


  // ## Memory Backend - uses in-memory data
  //
  // To use it you should provide in your constructor data:
  // 
  //   * metadata (including fields array)
  //   * documents: list of hashes, each hash being one doc. A doc *must* have an id attribute which is unique.
  //
  // Example:
  // 
  //  <pre>
  //  // Backend setup
  //  var backend = recline.Backend.Memory();
  //  backend.addDataset({
  //    metadata: {
  //      id: 'my-id',
  //      title: 'My Title'
  //    },
  //    fields: [{id: 'x'}, {id: 'y'}, {id: 'z'}],
  //    documents: [
  //        {id: 0, x: 1, y: 2, z: 3},
  //        {id: 1, x: 2, y: 4, z: 6}
  //      ]
  //  });
  //  // later ...
  //  var dataset = Dataset({id: 'my-id'}, 'memory');
  //  dataset.fetch();
  //  etc ...
  //  </pre>
  my.PouchFilter = my.Base.extend({
    __type__: 'pouchfilter',
    initialize: function(callback) {
      var datasets = localStorage.getItem('datasets')
      
      if (datasets) this.datasets = JSON.parse(datasets)
      else this.datasets = {}
      
      this.pouch = {}
      this.crossfilter = {}
      
      var results = {}
      _.each(_.keys(this.datasets), function(dataset) {
        results[dataset] = function(done) {
          new Pouch('idb://' + dataset, done)
        }
      })

      async.parallel(results, function(err, pouches) {
        if (err) console.error(err)
        this.pouch = pouches
      })
    },
    addDataset: function(data, callback) {
      var self = this
      this.datasets[data.metadata.id] = $.extend(true, {}, data);
      localStorage.setItem('datasets', JSON.stringify(this.datasets))
      new Pouch('idb://' + data.metadata.id, function(err, db) {
        if (err) return callback(err)
        self.pouch[data.metadata.id] = db
        callback(false, db)
      })
    },
    sync: function(method, model, options) {
      
      var self = this;
      var dfd = $.Deferred();
      if (method === "read") {
        if (model.__type__ == 'Dataset') {
          var datasets = localStorage.getItem('datasets')
          if (datasets) var rawDataset = JSON.parse(datasets)[model.id]
          else var rawDataset = {}
          self.pouch[model.id].allDocs({include_docs: true}, function(err, resp) {
            self.crossfilter[model.id] = crossfilter(_.map(resp.rows, function(r) { return r.doc }))
            model.docCount = resp.total_rows
            dfd.resolve(model)
          })
          
          model.set(rawDataset.metadata);
          model.fields.reset(rawDataset.fields);
        }
        return dfd.promise();
      } else if (method === 'update') {
        if (model.__type__ == 'Document') {
          this.pouch[model.dataset.id].put(_.extend({}, model.toJSON(), {_id: model.id}), function(err, resp) {
            dfd.resolve(model)
          })
        }
        return dfd.promise();
      } else if (method === 'delete') {
        if (model.__type__ == 'Document') {
          this.pouch[model.dataset.id].remove(model.toJSON(), function(err, resp) {
            console.log('delete', err, resp)
          })
          dfd.resolve(model);
        }
        return dfd.promise();
      } else {
        alert('Not supported: sync on PouchFilter backend with method ' + method + ' and model ' + model);
      }
    },
    query: function(model, queryObj) {
      var self = this
      var dfd = $.Deferred();
      var out = {};
      var numRows = queryObj.size;
      var start = queryObj.from;
      
      console.log(self.crossfilter[model.id])
      results = this._applyFilters(model, results, queryObj);
      // this._applyFreeTextQuery(model, results, queryObj);
      
      // not complete sorting!
      // _.each(queryObj.sort, function(sortObj) {
      //   var fieldName = _.keys(sortObj)[0];
      //   results = _.sortBy(results, function(doc) {
      //     var _out = doc[fieldName];
      //     return (sortObj[fieldName].order == 'asc') ? _out : -1*_out;
      //   });
      // });
      
      out.facets = this._computeFacets(results, queryObj);
      var total = results.length;
      resultsObj = this._docsToQueryResult(results.slice(start, start+numRows));
      _.extend(out, resultsObj);
      out.total = total;
      dfd.resolve(out);
      return dfd.promise();
    },
    
    _initializeFilter: function(model, field) {
      var self = this
      if (self.pouchfilters[model.id][field]) return
      else self.pouchfilters[model.id][field] = crossfilter.dimension(function(r) { return r[field] })
    },

    // in place filtering
    _applyFilters: function(model, results, queryObj) {
      var self = this
      var rows = []
      _.each(queryObj.filters, function(filter) {
        var fieldId = _.keys(filter.term)[0]
        self._initializeFilter(model, fieldId)
        rows.concat(self.pouchfilters[model.id][field].top(queryObj.size))
      })
      return rows;
    },

    // // we OR across fields but AND across terms in query string
    // _applyFreeTextQuery: function(dataset, results, queryObj) {
    //   if (queryObj.q) {
    //     var terms = queryObj.q.split(' ');
    //     results = _.filter(results, function(rawdoc) {
    //       var matches = true;
    //       _.each(terms, function(term) {
    //         var foundmatch = false;
    //         dataset.fields.each(function(field) {
    //           var value = rawdoc[field.id].toString();
    //           // TODO regexes?
    //           foundmatch = foundmatch || (value === term);
    //           // TODO: early out (once we are true should break to spare unnecessary testing)
    //           // if (foundmatch) return true;
    //         });
    //         matches = matches && foundmatch;
    //         // TODO: early out (once false should break to spare unnecessary testing)
    //         // if (!matches) return false;
    //       });
    //       return matches;
    //     });
    //   }
    //   return results;
    // },

    _computeFacets: function(documents, queryObj) {
      var facetResults = {};
      if (!queryObj.facets) {
        return facetsResults;
      }
      _.each(queryObj.facets, function(query, facetId) {
        facetResults[facetId] = new recline.Model.Facet({id: facetId}).toJSON();
        facetResults[facetId].termsall = {};
      });
      // faceting
      _.each(documents, function(doc) {
        _.each(queryObj.facets, function(query, facetId) {
          var fieldId = query.terms.field;
          var val = doc[fieldId];
          var tmp = facetResults[facetId];
          if (val) {
            tmp.termsall[val] = tmp.termsall[val] ? tmp.termsall[val] + 1 : 1;
          } else {
            tmp.missing = tmp.missing + 1;
          }
        });
      });
      _.each(queryObj.facets, function(query, facetId) {
        var tmp = facetResults[facetId];
        var terms = _.map(tmp.termsall, function(count, term) {
          return { term: term, count: count };
        });
        tmp.terms = _.sortBy(terms, function(item) {
          // want descending order
          return -item.count;
        });
        tmp.terms = tmp.terms.slice(0, 10);
      });
      return facetResults;
    }
  });

}(jQuery, this.recline.Backend));