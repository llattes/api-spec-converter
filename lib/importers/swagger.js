var parser = require('swagger-parser'),
    Endpoint = require('../entities/endpoint'),
    Schema = require('../entities/schema'),
    Importer = require('./importer'),
    Project = require('../entities/project'),
    jsonHelper = require('../utils/json'),
    swaggerHelper = require('../helpers/swagger'),
    YAML = require('js-yaml'),
    _ = require('lodash');

function Swagger() {
  this.dereferencedAPI = null;
}

var referenceRegex = /\/(parameters|responses)\//i;
function needDeReferenced(param) {
  if (!param || !param.$ref) {
    return false;
  }

  return param.$ref.match(referenceRegex);
}

function mapExample(data, target) {
  if (data.example) {
    target.example = jsonHelper.stringify(data.example, 4);
    delete data.example;
  }
}

Swagger.prototype = new Importer();

Swagger.prototype._mapSecurityDefinitions = function(securityDefinitions) {
  var result = {};
  for(var name in securityDefinitions) {
    var type = securityDefinitions[name].type;
    if (!result.hasOwnProperty(type)) {
      result[type] = {};
    }
    var sd = securityDefinitions[name];
    switch(type) {
      case 'apiKey':
        var keyPlaceHolder = (sd.in === 'header')?'headers':'queryString';
        if (!result[type].hasOwnProperty(keyPlaceHolder)){
          result[type][keyPlaceHolder] = [];
        }
        result[type][keyPlaceHolder].push({
          name: sd.name,
          value: ''
        });
        break;
      case 'oauth2':
        result[type] = {
          name: name,
          authorizationUrl: sd.authorizationUrl || '',
          scopes: slScopes,
          tokenUrl: sd.tokenUrl || ''
        };

        var slScopes = [], swaggerScopes = sd.scopes;

        if (swaggerScopes) {
          for(var key in swaggerScopes) {
            var scope = {};
            scope['name'] = key;
            scope['value'] = swaggerScopes[key];
            slScopes.push(scope);
          }
        }

        if (sd.flow) {
          result[type]['flow'] = sd.flow;
        }

        if (Array.isArray(slScopes) && slScopes.length > 0) {
          result[type]['scopes'] = slScopes;
        }

        break;
      case 'basic':
        result[type] = {
          name: name,
          value: '',
          description: sd.description || ''
        };
        break;
    }
  }
  return result;
};

Swagger.prototype._mapSchema = function(schemaDefinitions) {
  var result = [];
  for (var schemaName in schemaDefinitions) {
    var sd = new Schema(schemaName);
    sd.Name = schemaName;
    //create a close to remove extension properties
    var schemaDataClone = _.clone(schemaDefinitions[schemaName]);
    var re = /^x-/; //properties to avoid
    for(var prop in schemaDataClone) {
      if (prop.match(re)) {
        delete schemaDataClone[prop];
      }
    }

    mapExample(schemaDataClone, sd);
    sd.Definition = jsonHelper.stringify(schemaDataClone, 4);
    result.push(sd);
  }
  return result;
};

Swagger.prototype._mapQueryString = function(params, skipParameterRefs) {
  var queryString = {type:'object', properties: {}, required: []};
  for (var i in params) {
    var param = params[i];

    if (skipParameterRefs && needDeReferenced(param)) {
      continue;
    }

    if (param.in && param.in !== 'query') {
      //skip other type of params
      continue;
    }
    queryString.properties[param.name] = swaggerHelper.setParameterFields(param, {});
    if (param.required) {
      queryString.required.push(param.name);
    }
  }
  return queryString;
};

Swagger.prototype._mapURIParams = function(params, resolvedParameters) {
  var pathParams = {type:'object', properties: {}, required: []};
  for (var i in params) {
    var param = params[i];
    if (needDeReferenced(param) && resolvedParameters) {
      param = resolvedParameters[i];
    }

    if (param.in && param.in !== 'path') {
      //skip other type of params
      continue;
    }
    pathParams.properties[param.name] = swaggerHelper.setParameterFields(param, {});
    pathParams.required.push(param.name);
  }

  return pathParams;
};

Swagger.prototype._mapRequestBody = function(params, reqType, resolvedParams) {
  var data = {mimeType: reqType || null, body: {properties: {}, required: []}, example: ''};

  for (var i in params) {
    var param = params[i];

    if (needDeReferenced(param)) {
      param = resolvedParams[i];
    }

    if (param.in && param.in !== 'body' && param.in !== 'formData') {
      continue;
    }
    switch(param.in) {
      case 'body':
        mapExample(param.schema, data);
        data.body = param.schema;
        break;
      case 'formData':
      default:
        var prop = {};
        prop = swaggerHelper.setParameterFields(param, prop);
        if (param.required) {
          data.body.required.push(param.name);
        }
        data.body.properties[param.name] = prop;
    }
  }
  //remove required field if doesn't have anything inside it
  if (data.body.required && data.body.required.length == 0) {
    delete data.body.required;
  }
  return data;
};

Swagger.prototype._mapResponseBody = function(responseBody, resType, skipParameterRefs, resolvedResponses) {
  var data = [];
  for (var code in responseBody) {
    var res = {mimeType: resType, body: {}, example: '', codes: []}, description = '';

    if (skipParameterRefs && needDeReferenced(responseBody[code]) && responseBody[code].$ref.match(/trait/)) {
      continue;
    }

    // TODO: Once we support headers, then support headers from swagger spec in responses.
    if (needDeReferenced(responseBody[code]) && resolvedResponses) {
        schema = resolvedResponses[code].schema;
        description = resolvedResponses[code].description || '';
        res.body = schema;
    } else if (responseBody[code].schema) {
      var schema = responseBody[code].schema;
      if (needDeReferenced(responseBody[code].schema)) {
        description = resolvedResponses[code].description || '';
        schema = resolvedResponses[code].schema;
      }
      res.body = schema;
    }

    if (responseBody[code].hasOwnProperty('examples')) {
      for(var t in responseBody[code].examples) {
        if (t === resType) {
          res.example = jsonHelper.stringify(responseBody[code].examples[t], 4);
        }
      }
    }

    res.description = description || responseBody[code].description || '';
    res.body = jsonHelper.stringify(res.body, 4);

    var newCode = typeof parseInt(code) === 'string' ? code : parseInt(code);
    res.codes.push(newCode);

    // if this is a string/nan code (normally 'default'), and the schema is empty, we don't import it
    if ((typeof newCode === 'string' || isNaN(newCode)) && jsonHelper.isEmptySchema(res.body)) {
      continue;
    }

    data.push(res);
  }

  return data;
};

Swagger.prototype._mapRequestHeaders = function(params, skipParameterRefs) {
  var data = {type: 'object', properties: {}, required: []};
  for (var i in params) {
    var param = params[i];

    if (skipParameterRefs && needDeReferenced(param)) {
      continue;
    }

    if (param.in !== 'header') {
      //skip other type of params
      continue;
    }

    data.properties[param.name] = swaggerHelper.setParameterFields(param, {});;
    if (param.required) {
      data.required.push(param.name);
    }
  }
  return data;
};

Swagger.prototype._parseData = function(dataOrPath, cb) {
  var me = this;

  // with validation
  //in case of data, if not cloned, referenced to resolved data
  var dataCopy = _.cloneDeep(dataOrPath);
  parser.validate(dataCopy)
  .then(function() {
    me._doParseData(dataOrPath, cb);
  })
  .catch(function(err){
    me.parserError = err;
    me._doParseData(dataOrPath, cb);
  });
};

Swagger.prototype._doParseData = function(dataOrPath, cb) {
  var me = this;

  // without validation
  parser.parse(dataOrPath, function(err, api) {
    if (err) {
      cb(err);
    } else {
      me.data = api;

      parser.dereference(JSON.parse(JSON.stringify(api)))
      .then(function(dereferencedAPI) {
        me.dereferencedAPI = dereferencedAPI;
        cb();
      })
      .catch(function(err) {
        if (!me.parserError) {
          me.parserError = err;
        }

        cb();
      });
    }
  });
};

// Load a swagger spec by local or remote file path
Swagger.prototype.loadFile = function (path, cb) {
  return this._parseData(path, cb);
};

// Load a swagger spec by string data
Swagger.prototype.loadData = function(data) {
  var me = this, parsedData;
  return new Promise(function(resolve, reject){
    try {
      parsedData = JSON.parse(data);
    } catch(err) {
      //Possibly YAML Data
      try {
        parsedData = YAML.safeLoad(data);
      } catch(err) {
        return reject(err);
      }
    }

    me._parseData(parsedData, function(err){
      if (err) return reject(err);
      resolve();
    });
  });
};

//for now, if 'application/json' exist in supported type, use that
Swagger.prototype.findDefaultMimeType = function(mimeTypes) {
  if (!mimeTypes || mimeTypes.length <= 0) {
    return 'application/json';
  }
  for(var i in mimeTypes) {
    if (mimeTypes[i] === 'application/json') {
      return mimeTypes[i];
    }
  }
  return mimeTypes[0];
};

Swagger.prototype._mapEndpointTrait = function(params) {
  var traits = [];

  for (var i in params) {
    var param = params[i];

    if (!needDeReferenced(param)) {
      continue;
    }

    var parts = param.$ref.split('/'),
        traitParts = parts[parts.length - 1].split(':'),
        name = traitParts[0];
    if (traitParts[0] === 'trait') {
      name = traitParts[1];
    }
    traits.push(name);
  }

  return traits;
};

Swagger.prototype._mapEndpointTraits = function(params, responses) {
  var traits = [];

  traits = traits.concat(this._mapEndpointTrait(params));
  traits = traits.concat(this._mapEndpointTrait(responses));

  return _.uniq(traits);
};

Swagger.prototype._mapEndpoints = function(defaultReqContentType, defaultResContentType) {
  for (var path in this.data.paths) {
    var methods = this.data.paths[path];
    var pathParams = {};
    if (methods.parameters) {
      var resolvedPathParames = this.dereferencedAPI ? this.dereferencedAPI.paths[path].parameters : methods.parameters;
      pathParams = this._mapURIParams(methods.parameters, resolvedPathParames);
    }

    for (var method in methods) {
      var currentMethod = methods[method];
      var currentMethodResolved = this.dereferencedAPI ? this.dereferencedAPI.paths[path][method] : currentMethod;

      if (method === 'parameters') {
        continue;
      }
      var endpoint = new Endpoint(currentMethod.summary || ''),
          reqType = defaultReqContentType,
          resType = defaultResContentType;

      endpoint.Method = method;
      endpoint.Path = path;

      endpoint.tags = currentMethod.tags || [];
      endpoint.Summary = (currentMethod.summary || '').substring(140);
      endpoint.Description = currentMethod.description || currentMethod.summary;

      endpoint.SetOperationId(currentMethod.operationId, method, path);

      //map request body
      if (methods[method].consumes) {
        //taking only one
        reqType = this.findDefaultMimeType(currentMethod.consumes);
      }
      if (endpoint.Method.toLowerCase() !== 'get' &&
          endpoint.Method.toLowerCase() !== 'head') {
        endpoint.Body = this._mapRequestBody(currentMethod.parameters, reqType, currentMethodResolved.parameters);
      }

      // this needs to happen before the mappings below, because param/response $refs will be removed after those mappings
      endpoint.traits = this._mapEndpointTraits(currentMethod.parameters, currentMethod.responses);

      //if path params are defined in this level
      pathParams = _.merge(pathParams, this._mapURIParams(currentMethod.parameters, currentMethodResolved.parameters));
      //map path params
      endpoint.PathParams = pathParams;

      //map headers
      endpoint.Headers = this._mapRequestHeaders(currentMethod.parameters, true);

      //map query string
      endpoint.QueryString = this._mapQueryString(currentMethod.parameters, true);

      //map response body
      if (methods[method].produces) {
        //taking only one
        resType = this.findDefaultMimeType(currentMethod.produces);
      }
      endpoint.Responses = this._mapResponseBody(currentMethod.responses, resType, true, currentMethodResolved.responses);

      //map security
      if (currentMethod.security) {
        var securities = currentMethod.security;
        for (var securityIndex in securities) {
          var keys = Object.keys(securities[securityIndex]);
          var securityName = keys[0];
          var scheme = this.data.securityDefinitions[securityName];
          if (!scheme) {
            //definition error
            continue;
          }
          switch(scheme.type) {
            case 'apiKey':
            case 'basic':
              if (endpoint.SecuredBy.none) {
                endpoint.SecuredBy = {};
              }
              endpoint.SecuredBy[scheme.type] = true;
              break;
            case 'oauth2':
              if (endpoint.SecuredBy.none) {
                endpoint.SecuredBy = {};
              }
              endpoint.SecuredBy[scheme.type] = securities[securityIndex][securityName];
              break;
          }
        }
      }

      this.project.addEndpoint(endpoint);
    }
  }
};

Swagger.prototype._mapTraits = function(parameters, responses) {
  var traits = {},
      queryParams = {},
      headerParams = {},
      traitResponses = {};

  for (var k in parameters) {
    var param = parameters[k],
        parts = k.split(':'),
        name = k;

    if (parts[0] === 'trait') {
      name = parts[1];
    }

    switch (param.in) {
      case 'query':
        queryParams[name] = queryParams[name] || [];
        queryParams[name].push(param);
        break;
      case 'header':
        headerParams[name] = headerParams[name] || [];
        headerParams[name].push(param);
        break;
    }
  }

  for (var k in responses) {
    var response = responses[k],
        parts = k.split(':'),
        name = k,
        code = k;

    if (parts[0] === 'trait') {
      isTrait = true;
      name = parts[1];
      code = parts[2];
    } else {
      continue;
    }

    traitResponses[name] = traitResponses[name] || {};
    traitResponses[name][code] = response;
  }

  for (var k in queryParams) {
    var trait = traits[k] || {
      _id: k,
      name: k,
      request: {},
      responses: []
    };

    trait.request.queryString = this._mapQueryString(queryParams[k]);
    traits[k] = trait;
  }

  for (var k in headerParams) {
    var trait = traits[k] || {
      _id: k,
      name: k,
      request: {},
      responses: []
    };

    trait.request.headers = this._mapRequestHeaders(headerParams[k]);
    traits[k] = trait;
  }

  for (var k in traitResponses) {
    var trait = traits[k] || {
      _id: k,
      name: k,
      request: {},
      responses: []
    };

    trait.responses = this._mapResponseBody(traitResponses[k], 'application/json');
    traits[k] = trait;
  }

  return _.values(traits);
};

Swagger.prototype._import = function() {
  var defaultReqContentType = this.findDefaultMimeType(this.data.consumes),
      defaultResContentType = this.findDefaultMimeType(this.data.produces);

  this.project = new Project(this.data.info.title);
  this.project.Description = this.data.info.description || '';

  var protocol = 'http';
  if (this.data.schemes && this.data.schemes.length > 0) {
    this.project.Environment.Protocols = this.data.schemes;
    protocol = this.data.schemes[0];
  }

  this._mapEndpoints(defaultReqContentType, defaultResContentType);

  this.project.Environment.summary = this.data.info.description || '';
  this.project.Environment.BasePath = this.data.basePath || '';
  this.project.Environment.Host = this.data.host ? (protocol + '://' + this.data.host) : null;
  this.project.Environment.Version = this.data.info.version;

  if (this.data.produces) {
    //taking the first as default one
    this.project.Environment.DefaultResponseType = defaultResContentType;
  }

  if (this.data.consumes) {
    //taking the first as default one
    this.project.Environment.DefaultRequestType = defaultReqContentType;
  }
  if (this.data.securityDefinitions) {
    this.project.Environment.SecuritySchemes = this._mapSecurityDefinitions(this.data.securityDefinitions);
  }

  this.project.traits = this._mapTraits(this.data.parameters, this.data.responses);

  var schemas = this._mapSchema(this.data.definitions);
  for(var i in schemas) {
    this.project.addSchema(schemas[i]);
  }
};

module.exports = Swagger;
