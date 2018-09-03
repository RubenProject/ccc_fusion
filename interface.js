"use strict";

window.onerror = function(msg, src, line){
  alert("\"" + msg + "\"\nin " + src.split("/").splice(-1) + ":" + line);
};

var Playground = Playground || {};
Reo && (Reo.debug = false);

Playground.Playground = function(elements, options){
  // Playground object.
  if(!(this instanceof Playground.Playground))
    return;

  this.options = options || {};
  this._elements = elements;

  this.animation = new Reo.Animation(elements["animation"]);
  this.timeline = new Playground.Timeline(elements["timeline"], this);

  //conversion dictionary
   this.typeConversion = {
       sync: "sync",
       lossysync: "lossySync",
       syncdrain: "syncDrain",
       syncspout: "syncSpout",
       fifo1: "fifo1/0",
       filter: "sync",
   };

  // prepare controls
  this._elements["controlPlay"] = $(".play", this._elements["controls"])[0];
  this._elements["controlPlay"].onclick = (function(){
    // Start/stop animation.
    if(this.animation.state=="idle")
      this.startAnimation();
    else
      this.stopAnimation();
  }).bind(this);

  $(".backward", this._elements["controls"])[0].onclick = (function(){
    this.stopAnimation();

    var tick = Math.max(this.timeline.currentTick - 1, 0);
    this.setTick(tick);
  }).bind(this);

  $(".forward", this._elements["controls"])[0].onclick = (function(){
    this.stopAnimation();

    var tick = Math.min(this.timeline.currentTick + 1,
                        this.timeline.options.maxTicks - 1);
    this.setTick(tick);
  }).bind(this);


  this._elements["swap"].onclick = (function(){
    if (this._elements["swap"].value == "Edit!") {
        this._elements["swap"].value = "Animate!";
        this._elements["animationPanel"].style.display = "none";
        this._elements["editorPanel"].style.display = "block";
    } else {
        this._elements["swap"].value = "Edit!";
        this._elements["animationPanel"].style.display = "block";
        this._elements["editorPanel"].style.display = "none";

        //update content
        var connector = this.fetchInput()
        if(!connector)
          return;

        this.stopAnimation();

        // change connector
        if(!("nodes" in connector)){
          this.animation.connector = null;
          return;
        }
        //set new input for the animation
        this.animation.connector = new Reo.Connector(connector.nodes,
                                                     connector.channels,
                                                     connector.components);

        // clean up the timeline
        this.timeline.clear();
        this.timeline.nodes = [];
        for(var i in this.animation.connector.nodes){
          var node = this.animation.connector.nodes[i];
          if(node.type=="read" || node.type=="write"){
            this.timeline.io.push([]);
            this.timeline.nodes.push(node);
          }
        }

        this.timeline.draw();

    }
  }).bind(this);

  $(window).on("window:resize", function(e) {playground.resizeCanvas()});
  this.resizeCanvas();
};


Playground.Playground.prototype.resizeCanvas = function(){
    animation.height = container.clientHeight - 120;
    animation.width = c.width;
};




Playground.Playground.prototype.fetchInput = function(){
    var pdata = {};

    pdata.desc = "input to animation engine";
    pdata.nodes = {};
    pdata.channels = {};
    
    //convert nodes to correct format
    for (var i = 0; i < data.nodes.length; i++) {
        pdata.nodes[data.nodes[i].id] = {
            coord: [data.nodes[i].left, data.nodes[i].top], 
            type: null 
        };
    }
    
    //convert channels to correct format
    var id;
    var sources;
    var sinks;
    var type;
    for (var i = 0; i < data.channels.length; i++) {
        id = data.channels[i].node1.id + data.channels[i].node2.id;
        sources = [];
        sinks = [];
        if (data.channels[i].end1 == "source"){        
            sources.push(data.channels[i].node1.id);
        } else if (data.channels[i].end1 == "sink"){
            sinks.push(data.channels[i].node1.id);
        }
        if (data.channels[i].end2 == "source"){
            sources.push(data.channels[i].node2.id);
        } else if (data.channels[i].end2 == "sink"){
            sinks.push(data.channels[i].node2.id);
        }
        //convert type names
        type = playgroundData.channels[this.typeConversion[data.channels[i].name]];
        pdata.channels[id] = {
                sources: sources,
                sinks: sinks,
                type: type,
        };
    }

    //correct node types...
    //flags to check for incoming / outgoing connections
    var in_flag;
    var out_flag;

    for (var i = 0; i < data.nodes.length; i++) {
        id = data.nodes[i].id;
        in_flag = false;
        out_flag = false;
        for (var j in pdata.channels) {
            for (var k = 0; k < pdata.channels[j].sources.length; k++) {
                if (pdata.channels[j].sources[k] == id)
                    out_flag = true;
            }
            for (var k = 0; k < pdata.channels[j].sinks.length; k++) {
                if (pdata.channels[j].sinks[k] == id)
                    in_flag = true;
            }
        }
        if (in_flag == true && out_flag == true) {
            pdata.nodes[id].type = "merge";
        } else if (in_flag == true && out_flag == false) {
            pdata.nodes[id].type = "read";
        } else if (in_flag == false && out_flag == true) {
            pdata.nodes[id].type = "write";
        } else if (in_flag == false && out_flag == false) {
            pdata.nodes[id].type = "merge";
        }
    }
    return pdata;
};

Playground.Playground.prototype.setTick = function(tick){
  // Set the current tick to [tick].
  this.timeline.currentTick = tick;
  this.timeline.draw();

  var tick = this.timeline.ticks[tick];
  if(!tick)
    return;

  var connector = this.animation.connector;

  connector.state = tick.state;
  connector.coloring = tick.coloring;
};

Playground.Playground.prototype.simulate = function(from){
  // Simulate the connector according the pending I/O on the timeline, starting
  //  from tick [from].
  var connector = this.animation.connector;
  console.time("Playground.simulate");

  this.stopAnimation();

  // reset all channel types
  connector.state = null;

  // simulate each tick
  var ioLog = [];
  for(var i = from; i < this.timeline.options.maxTicks; i++){
    // add all newly pending I/O in this tick
    var io = this.timeline.io;
    for(var j in io){
      ioLog = ioLog.concat(io[j].filter(function(n){
        return n.from==i;
      }));
    }

    // remove all fulfilled I/O
    // XXX: this assumes read and write nodes have only one end
    var ioEnds = ioLog.map(function(n){
      return connector.nodes[n.node].ends[0];
    }, this);

    // get all valid colorings, and separate those with flow
    var colorings = connector.validColorings(ioEnds),
        cols = (colorings.flow.length > 0)?colorings.flow:colorings.noFlow;

    // choose a coloring
    var col = cols[(this.timeline.variants[i] || 0) % cols.length];

    // check coloring of all ends in this tick and set 'to'-values
    var newLog = [],
        last = {};
    for(var j in ioEnds){
      if(!col || !(ioLog[j].node in col))
        throw new Error("Incomplete coloring");

      // XXX: this assumes read and write nodes have only one end
      var node = col[ioLog[j].node],
          end = node.sources.concat(node.sinks)[0];
      if(ioLog[j].node in last){
        // this event is in the to-range of an earlier event
        ioLog[j].node = null;
      }else if(end=="-"){
        // this event is fulfilled at this tick
        ioLog[j].to = i;
        delete last[ioLog[j].node];
      }else{
        ioLog[j].to = Infinity;
        newLog.push(ioLog[j]);
      }

      // remember the last still pending event for this node
      last[ioLog[j].node] = ioLog[j].from;
    }
    ioLog = newLog;

    // remember coloring and state in this tick
    this.timeline.ticks[i] = {io: ioEnds,
                              coloring: col,
                              state: connector.state};

    connector.coloring = col;
    connector.nextTick();
  }

  // restore all initial types and reset timeline
  connector.state = null;
  this.setTick(0);
  this.timeline.revalidate();

  console.timeEnd("Playground.simulate");
};

Playground.Playground.prototype.startAnimation = function(){
  // Start animation.
  var tick = this.timeline.ticks[this.timeline.currentTick];
  if(!tick)
    return;

  this.animation.io = tick.io;
  this.animation.connector.coloring = tick.coloring;

  this.animation.state = "start";
  this._elements["controlPlay"].setAttribute("data-state", "play");

  this.animation.finishCallback = (function(){
    this._nextTick();
  }).bind(this);
};

Playground.Playground.prototype.stopAnimation = function(){
  // Stop animation.
  this.animation.state = "idle";
  this._elements["controlPlay"].setAttribute("data-state", "pause");

  var connector = this.animation.connector;
  if(!connector)
    return;

  // restore all types
  for(var i in connector.channels){
    var chan = connector.channels[i];
    chan.animationType = null;
  }
};

Playground.Playground.prototype._nextTick = function(){
  // Continue animation with next tick.
  this.animation.connector.nextTick();

  this.timeline.currentTick++;
  if(this.timeline.currentTick < this.timeline.options.maxTicks){
    this.startAnimation();
  }else{
    this.stopAnimation();
    this.timeline.currentTick = this.timeline.options.maxTicks - 1;
  }

  this.timeline.draw();
};

Playground.Timeline = function(canvas, playground, options){
  // Timeline object.
  if(!(this instanceof Playground.Timeline))
    return;
  if(!(playground instanceof Playground.Playground))
    throw new TypeError("playground must be Playground.Playground");

  var opt = options || {
    tickWidth: 32,
    lineHeight: 16,
    lineOffset: 4.5
  };
  opt.nodeOffset = Math.ceil(opt.lineOffset + (opt.lineHeight / 2));
  opt.maxNodes = Math.floor(canvas.height / opt.lineHeight) - 1;
  opt.maxTicks = Math.floor(canvas.width / opt.tickWidth) - 1;

  this.options = opt;

  this.canvas = new Canvas(canvas);

  this.nodes = [];

  this.io = [];
  this.ticks = [];
  this.variants = [];

  this.currentTick = 0;

  // drag event callbacks
  this._drag = {
    active: false,
    node: null,
    tick: null,
    prev: null,

    begin: (function(x, y){
      // Begin of drag.
      var node = Math.floor((y - opt.lineOffset) / opt.lineHeight),
          tick = Math.floor(x / opt.tickWidth) - 1;
      if(tick < 0 || node < 0 || !this.nodes[node])
        return;

      this._drag.active = true;
      canvas.style.cursor = "col-resize";

      // remove existing tick from this node
      var i = this.io[node][tick];
      if(i){
        this._drag.prev = i;
        delete this.io[node][tick];
      }

      this._drag.node = node;
      this._drag.tick = tick;
      this.draw();
    }).bind(this),

    end: (function(){
      // End of drag.
      var node = this._drag.node,
          tick = this._drag.tick;
      if(!this._drag.active)
        return;

      this._drag.active = false;
      canvas.style.cursor = "default";

      // make sure we're not adding a bogus node
      if(this._validateTick(node, tick)){
        // add tick to this node
        var i = this.io[node][tick];
        if(tick!=null && !i)
          this.io[node][tick] = {node: this.nodes[node].id,
                                 from: tick, to: -1};
      }

      // re-simulate connector
      this.variants[tick] = (this.variants[tick] + 1) || 0;
      playground.simulate(0);

      this._drag.node = null;
      this._drag.prev = null;
      this.draw();
    }).bind(this),

    move: (function(x, y){
      // Pointer movement.
      if(!this._drag.active)
        return;

      // bars count as 'outside the timeline'
      var node = Math.floor((y - opt.lineOffset) / opt.lineHeight),
          tick = Math.floor(x / opt.tickWidth);
      if(tick==0 || node >= opt.maxNodes)
        return drag.leave();

      this._drag.tick = tick - 1;
      this.draw();
    }).bind(this),

    leave: (function(){
      // Pointer leaves timeline.
      if(!this._drag.active)
        return;

      this._drag.tick = null;
      this.draw();
    }).bind(this)
  };

  // attach pointer event handlers
  var drag = this._drag;

  canvas.onmousedown = function(e){
    e.preventDefault();
    return drag.begin(e.offsetX, e.offsetY);
  };
  canvas.onmousemove = function(e){
    return drag.move(e.offsetX, e.offsetY);
  };
  canvas.onmouseout = drag.leave;
  document.onmouseup = function(e){
    return drag.end();
  };

  // attach touch event handlers
  canvas.ontouchstart = function(e){
    e.preventDefault();
    return drag.begin(e.targetTouches[0].pageX - canvas.offsetLeft,
                      e.targetTouches[0].pageY - canvas.offsetTop);
  };
  canvas.ontouchmove = function(e){
    var x = e.targetTouches[0].pageX - canvas.offsetLeft,
        y = e.targetTouches[0].pageY - canvas.offsetTop;
    if(x < 0 || y < 0 || x > canvas.width || y > canvas.height)
      return drag.leave();

    return drag.move(x, y);
  };
  canvas.ontouchend = document.onmouseup;
  canvas.ontouchleave = drag.leave;
};

Playground.Timeline.prototype.clear = function(){
  // Clear all I/O events from the timeline.
  this.io = [];
  this.ticks = [];
  this.currentTick = 0;
};

Playground.Timeline.prototype._validateTick = function(node, tick){
  // Returns whether it is possible to place an I/O event for [node] at [tick].
  for(var i in this.io[node]){
    var io = this.io[node][i];
    if(tick >= io.from && tick <= io.to)
      return false;
  }
  return true;
};

Playground.Timeline.prototype.revalidate = function(){
  // Remove ticks marked as impossibly placed by simulation.
  for(var i in this.io){
    var io = this.io[i];
    for(var j in io){
      if(io[j].node==null)
        delete io[j];
    }
  }
};

Playground.Timeline.prototype.draw = function(){
  // Draw the timeline.
  this.canvas.clear();

  var half = (this.options.tickWidth * 1.5);
  var width = this.canvas.canvas.width,
      height = this.canvas.canvas.height;

  // draw left bar
  this.canvas.drawRect([0, 0], this.options.tickWidth, height,
                       null, {fill: "#ccc"});

  var coord = [(this.options.tickWidth / 2), this.options.nodeOffset];
  for(var i in this.nodes){
    this.canvas.drawText(coord, this.nodes[i].id,
                         {align: "center", baseline: "middle"});
    coord[1] += this.options.lineHeight;
  }

  // draw bottom bar
  this.canvas.drawRect([-10, height - this.options.lineHeight + 2],
                       width + 20, this.options.lineHeight + 10,
                       null, {stroke: "#ccc", fill: "#eee"});

  // draw all placed I/O
  for(var i in this.io){
    var node = this.io[i];
    for(var t in node){
      var io = node[t];

      var x = (io.from * this.options.tickWidth) + half,
          y = (i * this.options.lineHeight) + this.options.nodeOffset;

      var stop = ((0.5 + io.to) * this.options.tickWidth) + half;
      if(io.to >= io.from){
        // draw a cross where pending I/O is fulfilled
        this.canvas.drawLine([x, y], [stop, y]);
        this.canvas.drawLine([stop - 5, y - 5], [stop + 5, y + 5],
                             {stroke: "#0a0"});
        this.canvas.drawLine([stop + 5, y - 5], [stop - 5, y + 5],
                             {stroke: "#0a0"});
      }

      this.canvas.drawRect([x, y], 10, 10, {center: true},
                           {stroke: "#000", fill: "#fff"});
    }
  }

  // draw dragged I/O (if present)
  if(this._drag.active && this._drag.tick!=null){
    var x = (this._drag.tick * this.options.tickWidth) + half,
        y = (this._drag.node * this.options.lineHeight);
    this.canvas.drawRect([x, y + this.options.nodeOffset], 12, 12,
                         {center: true}, {stroke: "#c00", fill: "#fff"});
  }

  // draw current tick indicator
  var x = (this.currentTick * this.options.tickWidth) + half,
      y = (this.options.maxNodes + 1) * this.options.lineHeight;
  this.canvas.drawPolygon([x, y], {n: 3, radius: 8, angle: -Math.PI / 2},
                          {fill: "#000"});
};

var playground = (function(data){
  // Initialize Playground.
  var elements = {
    "timeline": $("#timeline")[0],
    "controls": $("#controls")[0],
    "animation": $("#animation")[0],
    "animationPanel": $("#animationPanel")[0],
    "editorPanel": $("#editorPanel")[0],
    "swap": $("#swapButton")[0]
  };

  return new Playground.Playground(elements, data);
})(playgroundData);
