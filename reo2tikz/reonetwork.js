if (typeof module !== 'undefined') {
  ReoComponent = require('./reocomponent.js');
  ReoComponentTemplate = require('./reocomponenttemplate.js');
}

function ReoNetwork(sourceLoader) {
  this.componentTemplates = {};
  this.sourceLoader = sourceLoader;
  this.componentDefinitions = [];

  this.cfgBoundInferPush = 0.25;
}

ReoNetwork.prototype.includeSource = async function (inclIdent) {
  let src = await this.sourceLoader(inclIdent);
  await this.processSource(src);
};

ReoNetwork.prototype.processSource = async function (src) {
  await this.parseComponent(src.replace(/[\n\r]/g, ''));
};

function genShapeDef(cname, args, shapedef) {
  function ReoComponentTikz() {}

  ReoComponentTikz.prototype = Object.create(ReoComponent.prototype);
  ReoComponentTikz.prototype.typeName = cname;
  ReoComponentTikz.prototype.define = function (definestate) {
    let argList = '', output = '';
    // let argmap = {'pos': 1, 'angle': 2, 'value': args.length + 3};
    let argmap = {};
    for (let i = 0; i < args.length; i++) {
      // argList += ',arg' + (i + 3);
      // argmap['pathto' + args[i]] = i + 3;
      argList += 'arg' + (i + 1) + ',';
      argmap['pathto' + args[i]] = i + 1;
    }
    let tikzsrc = shapedef;
    for (let k in argmap) {
      tikzsrc = tikzsrc.split('#' + k).join('arg' + argmap[k]);
    }
    // argList += ',arg' + (args.length + 3);
    // output += '\\def \\reodraw@@ !#1,#2@@!{\n'.format(this.typeName, argList);
    output += 'function reodraw@@(@@) {\n'.format(this.typeName, argList);
    output += tikzsrc;
    output += '\n}\n';
    return output
  };
  ReoComponentTikz.prototype.draw = function (nodes) {
    let argList = '', output = '';
    // for (let i = 0; i < args.length; i++) {
    //   argList += ', ' + this.genPath(this.waypointsToPortIndex[i]);
    // }
    // argList += ', ' + (this.value || '');

    for (let j = 0; j < this.waypointsToPortIndex.length; ++j) {
      argList += '{x:' + nodes[this.waypointsToPortIndex[j][0]][0] +
        ',y:' + nodes[this.waypointsToPortIndex[j][0]][1] +
        ',name:"' + this.waypointsToPortIndex[j][0] + '"},'
    }

    // output += ('  \\coordinate (tmp) at ($(@@,@@)$);\n'.format(this.pos[0], this.pos[1]));
    // output += ('  \\reodraw@@!tmp, @@@@!;\n'.format(this.typeName, this.angle, argList));
    output += '  reodraw@@(@@);\n'.format(this.typeName, argList);
    return output
  };

  return {cName: cname, impl: ReoComponentTikz, binding: []};
}

ReoNetwork.prototype.getImplementationFor = async function (cName, binding) {
  // exists?
  for (let impl of this.componentDefinitions) {
    if (impl.cName === cName && impl.binding.length === binding.length) {
      let err = false;
      for (let i = 0; i < impl.binding.length; i++) {
        if (impl.binding[i] !== binding[i]) {
          err = true;
        }
      }
      if (!err) {
        return impl;
      }
    }
  }

  // not yet existing, generate...
  if (!this.componentTemplates[cName]) {
    // no template known
    throw ("no template defined for " + cName);
  }

  let implementation = await this.componentTemplates[cName].implement(binding);
  let def = {cName: cName, impl: implementation, binding: binding};
  this.componentDefinitions.push(def);
  return def;
};

ReoNetwork.prototype.parseMeta = function (str) {
  let pmeta = /^\s*\/\*!(.*?)!\*\//g;
  let m2 = pmeta.exec(str);
  let mdataparsed = [];
  if (m2) {
    let mstr = m2[1].trim();
    // convert back to json
    // convert block type to json valid string, replace : with ` because regex isn't powerful enough for this
    mstr = mstr.replace(/{(({(({(({.*?}|.)*?)}|.)*?)}|.)*?)}/g, function (m, a, s) {return JSON.stringify(a.replace(/:/g, '`'))});
    // stringify keys, replace ` back for :
    let fixedstr = mstr.replace(/([a-z][^\s,()]*|[a-z]+\(.*?\)):/g, '"$1":');
    fixedstr = "{" + fixedstr.replace(/`/g, ':') + "}";

    let mdata = JSON.parse(fixedstr);
    str = str.substring(m2[0].length);

    for (let metakey in mdata) {
      let pkeyarg = /^(\w+)(\((.*?)\))?$/g;
      let m3 = pkeyarg.exec(metakey);
      if (!m3) {
        throw 'failed to parse meta key';
      }
      mdataparsed.push({key: m3[1], keyarg: m3[3], value: mdata[metakey]});
    }
  }

  return [str, mdataparsed];
};

ReoNetwork.prototype.processMeta = async function (s, env) {
  switch (s.key) {
    case 'shape':
      let m = /^([a-z]\w+)\((.*?)\)/.exec(s.keyarg);
      let cname = m[1];
      let args = m[2].replace(';', ',').split(',').map(function (x) {return x.trim()}).filter(function (x) {return x.length > 0});
      this.componentDefinitions.push(genShapeDef(cname, args, s.value));
      break;

    case 'include':
      await this.includeSource(s.value);
      break;

    default:
      throw "unknown metakey " + s.key;
  }
};

ReoNetwork.prototype.parseComponent = async function (str) {
  // first try to get some meta...
  let metaRes = this.parseMeta(str);
  str = metaRes[0];
  for (let s of metaRes[1]) {
    await this.processMeta(s, {});
  }

  // scope matching: {(({(({(({.*?}|.)*?)}|.)*?)}|.)*?)} < up to 3 nested
  // cname<templargs>(inargs, ; outargs, ) { innerscope }
  let p = /^\s*(\w+)(?:<([^>]*)>)?\(([^);]*)(;([^);]+))?\)\s*{(({(({(({.*?}|.)*?)}|.)*?)}|.)*?)}\s*/g;
  let m = p.exec(str);
  if (m) {
    // Template definition
    let matchStr = m[0];
    let cName = m[1];
    let argsTempl = (m[2] || '').split(',').map(function (x) {return x.trim()}).filter(function (x) {return x.length > 0});
    let argsIn = m[3].split(',').map(function (x) {return x.trim()}).filter(function (x) {return x.length > 0});
    let argsOut = (m[5] || '').split(',').map(function (x) {return x.trim()}).filter(function (x) {return x.length > 0});
    let innerScopeStr = m[6];

    str = str.substring(matchStr.length); // move to next
    let res = this.parseMeta(innerScopeStr);
    innerScopeStr = res[0]; // move to next component
    let mdata = res[1];

    this.componentTemplates[cName] = new ReoComponentTemplate(this, cName, argsTempl, argsIn, argsOut, innerScopeStr, mdata);

    this.parseComponent(str);
  }
};

ReoNetwork.prototype.generateCode = async function () {
  // let output = '\\begin{tikzpicture}\n' +
  //   '\\tikzset{gnode/.style={draw, shape=circle, fill=black, minimum size=3pt, inner sep=0pt, outer sep=0pt,label={90:#1}}};\n' +
  //   '\\def \\arrowstyle {\\arrow[scale=1.4]{stealth\'}}\n' +
  //   '\\def \\arrowstylerev {\\arrowreversed[scale=1.4]{stealth\'}};\n';

  let component = await this.getImplementationFor('main', []);
  let mainInstance = new component.impl();

  let definesstate = {}; // stores what's already been defined
  let output = mainInstance.define(definesstate);

  // output += '\\reoimpldraw@@!!\n'.format(mainInstance.typeName);
  output += 'reodraw@@();\n'.format(mainInstance.typeName);
  // output += '\\end{tikzpicture}\n';

  return output;
};

if (typeof module !== 'undefined') {
  module.exports = ReoNetwork;
}