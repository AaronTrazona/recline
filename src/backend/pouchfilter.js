this.recline = this.recline || {};
this.recline.Backend = this.recline.Backend || {};

(function($, my) {
  my.createPouchDataset = function(callback, data, fields, metadata) {
    if (!metadata) {
      metadata = {};
    }
    if (!metadata.id) {
      metadata.id = String(Math.floor(Math.random() * 100000000) + 1);
    }
    var backend = new recline.Backend.PouchFilter()
    var datasetInfo = {
      metadata: metadata
    };
    if (fields) {
      datasetInfo.fields = fields;
    } else {
      if (data) {
        datasetInfo.fields = _.map(data[0], function(value, key) {
          return {id: key}
        })
      }
    }
    
    backend.addDataset(datasetInfo)
    backend.makePouch(metadata.id, function (err, pouch) {
      pouch.bulkDocs({docs: data}, function(err, resp) {
        var dataset = new recline.Model.Dataset({id: metadata.id}, backend)
        callback(dataset)
      })
    })
  };
  
  my.PouchFilter = my.Base.extend({
    __type__: 'pouchfilter',
    initialize: function() {
      this.datasets = {}
      this.pouch = {}
      this.crossfilter = {}
      this.pouchfilters = {}
    },
    makePouch: function(id, callback) {
      var self = this
      if (this.pouch[id]) return callback(false, this.pouch[id])
      new Pouch('idb://' + id, function(err, db) {
        if (err) return callback(err)
        self.pouch[id] = db
        callback(false, db)
      })
    },
    addDataset: function(data, callback) {
      var self = this
      this.datasets[data.metadata.id] = $.extend(true, {}, data)
    },
    sync: function(method, model, options) {
      var self = this;
      var dfd = $.Deferred();
      if (method === "read") {
        if (model.__type__ == 'Dataset') {
          var rawDataset = self.datasets[model.id]
          if (!rawDataset) rawDataset = {}
          self.makePouch(model.id, function(err, pouch) {
            self.pouch[model.id].allDocs({include_docs: true}, function(err, resp) {
              var rows = _.map(resp.rows, function(r) { return r.doc })
              self.crossfilter[model.id] = crossfilter(rows)
              model.docCount = resp.total_rows
              dfd.resolve(model)
            })

            model.set(rawDataset.metadata);
            model.fields.reset(rawDataset.fields);
          })
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
      
      var firstField = self.datasets[model.id].fields[0]
      var filter = self._makeFilter(model, firstField.id)
      
      // var results = this._applyFilters(model, queryObj);
      // this._applyFreeTextQuery(model, results, queryObj);
      if (queryObj.sort && queryObj.sort.length > 0) {
        // dont support multiple sorts for now but maintain api compat with ES
        var sortObj = _.first(queryObj.sort)
        var fieldName = _.keys(sortObj)[0]
        filter = self._makeFilter(model, fieldName, sortObj)
        var results = filter.top(queryObj.size)
      } else {
        var results = filter.top(numRows)
      }
      
      
      // out.facets = this._computeFacets(results, queryObj);
      
      var total = self.crossfilter[model.id].size()
      resultsObj = this._docsToQueryResult(results)
      _.extend(out, resultsObj)
      out.total = total

      dfd.resolve(out)
      return dfd.promise()
    },
    
    // idempotent
    _makeFilter: function(model, field, sortObj) {
      var sort = "desc"
      if (sortObj) sort = sortObj[field].order
      if (!this.pouchfilters[model.id]) this.pouchfilters[model.id] = {}
      var filters = this.pouchfilters[model.id]
      if (!filters[field]) filters[field] = {}
      if (filters[field][sort]) return filters[field][sort]
      var dimension = function(r) { return r[field] }
      if (sort == 'asc') dimension = function(r) { return -1 * r[field] }
      filters[field][sort] = this.crossfilter[model.id].dimension(dimension)
      return filters[field][sort]
    },

    // in place filtering
    _applyFilters: function(model, queryObj) {
      var self = this
      var rows = []
      _.each(queryObj.filters, function(filter) {
        var fieldId = _.keys(filter.term)[0]
        self._makeFilter(model, fieldId)
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
