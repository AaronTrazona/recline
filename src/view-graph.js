/*jshint multistr:true */

this.recline = this.recline || {};
this.recline.View = this.recline.View || {};

(function($, my) {

// ## Graph view for a Dataset using Flot graphing library.
//
// Initialization arguments (in a hash in first parameter):
//
// * model: recline.Model.Dataset
// * state: (optional) configuration hash of form:
//
//        { 
//          group: {column name for x-axis},
//          series: [{column name for series A}, {column name series B}, ... ],
//          graphType: 'line'
//        }
//
// NB: should *not* provide an el argument to the view but must let the view
// generate the element itself (you can then append view.el to the DOM.
my.Graph = Backbone.View.extend({

  tagName:  "div",
  className: "recline-graph",

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
          <option value="lines-and-points">Lines and Points</option> \
          <option value="lines">Lines</option> \
          <option value="points">Points</option> \
          <option value="bars">Bars</option> \
          </select> \
        </div> \
        <label>Group Column (x-axis)</label> \
        <div class="input editor-group"> \
          <select> \
          <option value="">Please choose ...</option> \
          {{#fields}} \
          <option value="{{id}}">{{label}}</option> \
          {{/fields}} \
          </select> \
        </div> \
        <div class="editor-series-group"> \
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
  <div class="panel graph"> \
    <div class="js-temp-notice alert alert-block"> \
      <h3 class="alert-heading">Hey there!</h3> \
      <p>There\'s no graph here yet because we don\'t know what fields you\'d like to see plotted.</p> \
      <p>Please tell us by <strong>using the menu on the right</strong> and a graph will automatically appear.</p> \
    </div> \
  </div> \
</div> \
',
  templateSeriesEditor: ' \
    <div class="editor-series js-series-{{seriesIndex}}"> \
      <label>Series <span>{{seriesName}} (y-axis)</span> \
        [<a href="#remove" class="action-remove-series">Remove</a>] \
      </label> \
      <div class="input"> \
        <select> \
        <option value="">Please choose ...</option> \
        {{#fields}} \
        <option value="{{id}}">{{label}}</option> \
        {{/fields}} \
        </select> \
      </div> \
    </div> \
  ',

  events: {
    'change form select': 'onEditorSubmit',
    'click .editor-add': '_onAddSeries',
    'click .action-remove-series': 'removeSeries',
    'click .action-toggle-help': 'toggleHelp'
  },

  initialize: function(options) {
    var self = this;
    this.el = $(this.el);
    _.bindAll(this, 'render', 'redraw');
    // we need the model.fields to render properly
    this.model.bind('change', this.render);
    this.model.fields.bind('reset', this.render);
    this.model.fields.bind('add', this.render);
    this.model.currentDocuments.bind('add', this.redraw);
    this.model.currentDocuments.bind('reset', this.redraw);
    var stateData = _.extend({
        group: null,
        // so that at least one series chooser box shows up
        series: [""],
        graphType: 'lines-and-points'
      },
      options.state
    );
    this.state = new recline.Model.ObjectState(stateData);
    this.render();
  },

  render: function() {
    var self = this;
    var tmplData = this.model.toTemplateJSON();
    var htmls = $.mustache(this.template, tmplData);
    $(this.el).html(htmls);
    this.$graph = this.el.find('.panel.graph');

    // set up editor from state
    if (this.state.get('graphType')) {
      this._selectOption('.editor-type', this.state.get('graphType'));
    }
    if (this.state.get('group')) {
      this._selectOption('.editor-group', this.state.get('group'));
    }
    _.each(this.state.get('series'), function(series, idx) {
      self.addSeries(idx);
      self._selectOption('.editor-series.js-series-' + idx, series);
    });
    return this;
  },

  // Private: Helper function to select an option from a select list
  //
  _selectOption: function(id,value){
    var options = this.el.find(id + ' select > option');
    if (options) {
      options.each(function(opt){
        if (this.value == value) {
          $(this).attr('selected','selected');
          return false;
        }
      });
    }
  },

  onEditorSubmit: function(e) {
    var select = this.el.find('.editor-group select');
    var $editor = this;
    var $series  = this.el.find('.editor-series select');
    var series = $series.map(function () {
      return $(this).val();
    });
    var updatedState = {
      series: $.makeArray(series),
      group: this.el.find('.editor-group select').val(),
      graphType: this.el.find('.editor-type select').val()
    };
    this.state.set(updatedState);
    this.redraw();
  },

  redraw: function() {
    // There appear to be issues generating a Flot graph if either:

    // * The relevant div that graph attaches to his hidden at the moment of creating the plot -- Flot will complain with
    //
    //   Uncaught Invalid dimensions for plot, width = 0, height = 0
    // * There is no data for the plot -- either same error or may have issues later with errors like 'non-existent node-value' 
    var areWeVisible = !jQuery.expr.filters.hidden(this.el[0]);
    if ((!areWeVisible || this.model.currentDocuments.length === 0)) {
      return;
    }
    var series = this.createSeries();
    var options = this.getGraphOptions(this.state.attributes.graphType);
    this.plot = $.plot(this.$graph, series, options);
    this.setupTooltips();
    // create this.plot and cache it
//    if (!this.plot) {
//      this.plot = $.plot(this.$graph, series, options);
//    } else {
//      this.plot.parseOptions(options);
//      this.plot.setData(this.createSeries());
//      this.plot.resize();
//      this.plot.setupGrid();
//      this.plot.draw();
//    }
  },

  // ### getGraphOptions
  //
  // Get options for Flot Graph
  //
  // needs to be function as can depend on state
  //
  // @param typeId graphType id (lines, lines-and-points etc)
  getGraphOptions: function(typeId) { 
    var self = this;
    // special tickformatter to show labels rather than numbers
    // TODO: we should really use tickFormatter and 1 interval ticks if (and
    // only if) x-axis values are non-numeric
    // However, that is non-trivial to work out from a dataset (datasets may
    // have no field type info). Thus at present we only do this for bars.
    var tickFormatter = function (val) {
      if (self.model.currentDocuments.models[val]) {
        var out = self.model.currentDocuments.models[val].get(self.state.attributes.group);
        // if the value was in fact a number we want that not the 
        if (typeof(out) == 'number') {
          return val;
        } else {
          return out;
        }
      }
      return val;
    };

    var xaxis = {};
    // check for time series on x-axis
    if (this.model.fields.get(this.state.get('group')).get('type') === 'date') {
      xaxis.mode = 'time';
      xaxis.timeformat = '%y-%b';
    }
    var optionsPerGraphType = { 
      lines: {
        series: { 
          lines: { show: true }
        },
        xaxis: xaxis
      },
      points: {
        series: {
          points: { show: true }
        },
        xaxis: xaxis,
        grid: { hoverable: true, clickable: true }
      },
      'lines-and-points': {
        series: {
          points: { show: true },
          lines: { show: true }
        },
        xaxis: xaxis,
        grid: { hoverable: true, clickable: true }
      },
      bars: {
        series: {
          lines: {show: false},
          bars: {
            show: true,
            barWidth: 1,
            align: "center",
            fill: true,
            horizontal: true
          }
        },
        grid: { hoverable: true, clickable: true },
        yaxis: {
          tickSize: 1,
          tickLength: 1,
          tickFormatter: tickFormatter,
          min: -0.5,
          max: self.model.currentDocuments.length - 0.5
        }
      }
    };
    return optionsPerGraphType[typeId];
  },

  setupTooltips: function() {
    var self = this;
    function showTooltip(x, y, contents) {
      $('<div id="flot-tooltip">' + contents + '</div>').css( {
        position: 'absolute',
        display: 'none',
        top: y + 5,
        left: x + 5,
        border: '1px solid #fdd',
        padding: '2px',
        'background-color': '#fee',
        opacity: 0.80
      }).appendTo("body").fadeIn(200);
    }

    var previousPoint = null;
    this.$graph.bind("plothover", function (event, pos, item) {
      if (item) {
        if (previousPoint != item.datapoint) {
          previousPoint = item.datapoint;
          
          $("#flot-tooltip").remove();
          var x = item.datapoint[0];
          var y = item.datapoint[1];
          // it's horizontal so we have to flip
          if (self.state.attributes.graphType === 'bars') {
            var _tmp = x;
            x = y;
            y = _tmp;
          }
          // convert back from 'index' value on x-axis (e.g. in cases where non-number values)
          if (self.model.currentDocuments.models[x]) {
            x = self.model.currentDocuments.models[x].get(self.state.attributes.group);
          } else {
            x = x.toFixed(2);
          }
          y = y.toFixed(2);
          
          var content = _.template('<%= group %> = <%= x %>, <%= series %> = <%= y %>', {
            group: self.state.attributes.group,
            x: x,
            series: item.series.label,
            y: y
          });
          showTooltip(item.pageX, item.pageY, content);
        }
      }
      else {
        $("#flot-tooltip").remove();
        previousPoint = null;            
      }
    });
  },

  createSeries: function () {
    var self = this;
    var series = [];
    _.each(this.state.attributes.series, function(field) {
      var points = [];
      _.each(self.model.currentDocuments.models, function(doc, index) {
        var xfield = self.model.fields.get(self.state.attributes.group);
        var x = doc.getFieldValue(xfield);
        // time series
        var isDateTime = xfield.get('type') === 'date';
        if (isDateTime) {
          x = new Date(x);
        }
        var yfield = self.model.fields.get(field);
        var y = doc.getFieldValue(yfield);
        if (typeof x === 'string') {
          x = index;
        }
        // horizontal bar chart
        if (self.state.attributes.graphType == 'bars') {
          points.push([y, x]);
        } else {
          points.push([x, y]);
        }
      });
      series.push({data: points, label: field});
    });
    return series;
  },

  // Public: Adds a new empty series select box to the editor.
  //
  // @param [int] idx index of this series in the list of series
  //
  // Returns itself.
  addSeries: function (idx) {
    var data = _.extend({
      seriesIndex: idx,
      seriesName: String.fromCharCode(idx + 64 + 1),
    }, this.model.toTemplateJSON());

    var htmls = $.mustache(this.templateSeriesEditor, data);
    this.el.find('.editor-series-group').append(htmls);
    return this;
  },

  _onAddSeries: function(e) {
    e.preventDefault();
    this.addSeries(this.state.get('series').length);
  },

  // Public: Removes a series list item from the editor.
  //
  // Also updates the labels of the remaining series elements.
  removeSeries: function (e) {
    e.preventDefault();
    var $el = $(e.target);
    $el.parent().parent().remove();
    this.onEditorSubmit();
  },

  toggleHelp: function() {
    this.el.find('.editor-info').toggleClass('editor-hide-info');
  },
});

})(jQuery, recline.View);

