var Endpoint = require('../entities/endpoint'),
    Exporter = require('./exporter'),
    SwaggerParser = require('swagger-parser'),
    jsonHelper = require('../utils/json.js'),
    stringHelper = require('../utils/strings.js'),
    SwaggerDefinition = require('../entities/swagger/definition'),
    swaggerHelper = require('../helpers/swagger'),
    _ = require('lodash'),
    url = require('url');

function Swagger() {
  this.metadata = null;
}

function mapExample(data, target) {
  if (!_.isEmpty(data.example)) {
    var example = jsonHelper.parse(data.example);
    if (!_.isEmpty(example)) {
      target.example = example;
    }
  }
}

Swagger.prototype = new Exporter();

Swagger.prototype._getResponseTypes = function(slResponses) {
  var result = [];
  for(var i in slResponses) {
    var res = slResponses[i];
    if (res.mimeType) {
      result.push(res.mimeType);
    }
  }
  return _.uniq(result);
};

Swagger.prototype._getRequestTypes = function(endpoint, parameters, defaultRequestType) {
  var result = [], typesToInclude = ['multipart/form-data', 'application/x-www-form-urlencoded'];

  for(var i in parameters) {
    if (parameters[i].type && parameters[i].type === 'file') {
      //consumes must have 'multipart/form-data' or 'application/x-www-form-urlencoded'
      var reqBody = endpoint.Body;

      if (reqBody && typesToInclude.indexOf(reqBody.mimeType) >= 0) {
        result.push(reqBody.mimeType);
      } else if(typesToInclude.indexOf(defaultRequestType) >= 0) {
        result.push(defaultRequestType);
      } else {
        //as swagger spec validation must want one of these, add one
        result.push(typesToInclude[0]);
      }
      //no need for the further iterations
      break;
    }
  }
  if (result.length <= 0) {
    result.push(endpoint.Body.mimeType || defaultRequestType || 'application/json');
  }
  return _.uniq(result);
};


Swagger.prototype._validateParameters = function(parameters) {
  parameters = jsonHelper.orderByKeys(parameters, ['$ref', 'name', 'in', 'description', 'required', 'schema', 'type']);
  var validTypes = ['string', 'number', 'integer', 'boolean', 'array', 'file'], defaultType = 'string';
  for(var i in parameters) {
    if (parameters[i].in && parameters[i].in != 'body') {
      if (Array.isArray(parameters[i].type)) {
        if(parameters[i].type.length > 0) {
          parameters[i].type = parameters[i].type[0];
        } else {
          parameters[i].type = defaultType;
        }
      }
      if(validTypes.indexOf(parameters[i].type) < 0) {
        //type not valid
        parameters[i].type = defaultType;
      }
    }
  }
  return parameters;
};

Swagger.prototype._constructTags = function(endpoint, env) {
  var tags = endpoint.tags || [];

  var group = _.find(env.GroupsOrder.docs, function(g) {
    return _.find(g.items, ['_id', endpoint.operationId]);
  });

  if (group) {
    tags.push(group.name);
  }

  return _.uniq(tags);
};

Swagger.prototype._constructSwaggerMethod = function(endpoint, parameters, responses, env) {
  endpoint.SetOperationId(endpoint.operationId, endpoint.Method, endpoint.Path);

  var resultSwaggerMethod = {
    tags: this._constructTags(endpoint, env),
    summary: endpoint.Name,
    description: endpoint.Description,
    operationId: endpoint.operationId,
    consumes: this._getRequestTypes(endpoint, parameters, env.DefaultRequestType),
    produces: this._getResponseTypes(endpoint.Responses),
    parameters: parameters,
    responses: responses
  };

  if (_.isEmpty(resultSwaggerMethod.tags)) {
    delete resultSwaggerMethod.tags;
  }

  if (resultSwaggerMethod.operationId.length === 0) {
    //don't keep empty operationId in exported definition
    delete resultSwaggerMethod.operationId;
  }

  return resultSwaggerMethod;
};

Swagger.prototype._mapEndpointSecurity = function(securedByTypes, securityDefinitions) {
  var security = [];
  for (var type in securedByTypes) {
    var scheme = securityDefinitions[type];
    if (!scheme) {
      //definition error
      continue;
    }
    switch (type) {
      case 'basic':
        var result = {};
        if (scheme.name) {
          result[scheme.name] = [];
          security.push(result);
        }
        break;
      case 'apiKey':
        if (scheme.headers && scheme.headers.length > 0) {
          for(var i in scheme.headers) {
            var result = {};
            result[scheme.headers[i].name] = [];
            security.push(result);
          }
        }
        if (scheme.queryString && scheme.queryString.length > 0) {
          for(var i in scheme.queryString) {
            var result = {};
            result[scheme.queryString[i].name] = [];
            security.push(result);
          }
        }
        break;
      case 'oauth2':
        var result = {};
        result[type] = securedByTypes[type];
        security.push(result);
        break;
    }
  }
  return security;
};

Swagger.prototype._mapSecurityDefinitions = function(securityDefinitions) {
  var result = {};
  for(var type in securityDefinitions) {
    var sd = securityDefinitions[type];
    switch(type) {
      case 'apiKey':
        if (sd.hasOwnProperty('headers') && sd.headers.length > 0) {
          for(var i in sd.headers) {
            var header = sd.headers[i];
            result[header.name] = {
              name: header.name,
              type: type,
              in: 'header'
            };
          }
        }
        if (sd.hasOwnProperty('queryString') && sd.queryString.length > 0) {
          for(var i in sd.queryString) {
            var header = sd.queryString[i];
            result[header.name] = {
              name: header.name,
              type: type,
              in: 'query'
            };
          }
        }
        break;
      case 'oauth2':

        var slScopes = sd.scopes, swaggerScopes = {};
        for (var i in slScopes) {
          var scope = slScopes[i];
          swaggerScopes[scope.name] = scope.value;
        }

        result[type] = {
          type: type,
          flow: sd.flow,
          scopes: swaggerScopes
        };

        if (['implicit', 'accessCode'].indexOf(sd.flow) >= 0) {
          result[type]['authorizationUrl'] = sd.authorizationUrl;
        }

        if (['password', 'application', 'accessCode'].indexOf(sd.flow) >= 0) {
          result[type]['tokenUrl'] = sd.tokenUrl;
        }
        break;
      case 'basic':
        if (sd.name) {
          result[sd.name] = {
            type: type,
            description: sd.description || ''
          };
        }
        break;
    }
  }
  return result;
};


Swagger.prototype._mapURIParams = function(pathParams) {
  var parameters = [];
  if (!pathParams.properties || Object.keys(pathParams).length == 0) {
    return parameters;
  }

  for (var paramName in pathParams.properties) {
    var prop = pathParams.properties[paramName];
    var param = swaggerHelper.setParameterFields(prop, {});
    param.name = paramName;
    param.in = 'path';
    param.required = true;
    param.type = param.type || 'string';
    if (prop.description) {
      param.description = prop.description;
    }
    parameters.push(param);
  }
  return parameters;
};

Swagger.prototype._mapQueryString = function(queryStringParams) {
  var parameters = [];
  if (!queryStringParams.properties) {
    return parameters;
  }
  for (var paramName in queryStringParams.properties) {
    var param = swaggerHelper.setParameterFields(queryStringParams.properties[paramName], {});
    param.name = paramName;
    param.in = 'query';
    param.required = (queryStringParams.required &&
        queryStringParams.required.indexOf(param.name) >= 0);
    parameters.push(param);
  }
  return parameters;
};

function mapResponseBody(res) {
  var item = {description: res.description || ''};
  if (res.body && res.body !== '{}' && res.body.length > 2) {
    item.schema = jsonHelper.parse(res.body);
  }
  if (res.example && res.example !== '{}' && res.example.length > 2) {
    item.examples = {};
    item.examples[res.mimeType] = jsonHelper.parse(res.example);
  }
  return item;
};

Swagger.prototype._mapResponseBody = function(slResponses) {
  var result = {};
  for(var i in slResponses) {
    var res = slResponses[i],
        item = mapResponseBody(res);
    result[(res.codes && res.codes.length > 0 && parseInt(res.codes[0]) ? res.codes[0] : 'default')] = item;
  }
  if (Object.keys(result).length == 0) {
    //empty schema for swagger spec validation
    result['default'] = {
      description: '',
      schema: {}
    };
  }
  return result;
};

Swagger.prototype._mapRequestBody = function(slRequestBody) {
  if (!slRequestBody.body) {
    return [];
  }
  var result = [], body = jsonHelper.parse(slRequestBody.body) || {};

  if (!jsonHelper.isEmptySchema(body)) {
    //make sure body isn't empty
    var param = {};
    var regex = /\"type\":[ ]*\"file\"|\"type\":[ ]*\"binary\"/;
    //export as formData only if schema includes file type property
    if (slRequestBody.body.match(regex)) {
      for(var prop in body.properties) {
        param = body.properties[prop];
        param.in = 'formData';
        param.name = prop;
        if (body.required && body.required.indexOf(prop) >= 0) {
          param.required = true;
        }
        result.push(param);
      }
    } else {
      if (body.required && body.required.length <= 0) {
        delete body.required;
      }

      mapExample(slRequestBody, body);

      param = {
        name: 'body',
        in: 'body',
        schema: body
      };

      result.push(param);
    }
  }

  return result;
};

Swagger.prototype._mapRequestHeaders = function(slHeaders) {
  var result = [];

  for(var property in slHeaders.properties) {
    var param = swaggerHelper.setParameterFields(slHeaders.properties[property], {});
    param.name = property;
    param.in = 'header';
    param.required = slHeaders.required && (slHeaders.required.indexOf(property) >= 0);
    param.description = slHeaders.properties[property].description || '';
    result.push(param);
  }
  return result;
};

Swagger.prototype._mapSchema = function(slSchemas) {
  var result = {};
  for (var i in slSchemas) {
    var schema = slSchemas[i];
    var definition = jsonHelper.parse(schema.Definition);
    mapExample(schema, definition);
    result[schema.NameSpace] = definition;
  }
  return result;
};

Swagger.prototype._mapEndpointTraitParameters = function (endpoint, existingParams) {
  if (!endpoint.traits || !endpoint.traits.length) {
    return [];
  }

  var params = [];

  for (var i in endpoint.traits) {
    var trait = _.find(this.project.Traits, ['_id', endpoint.traits[i]]);

    if (!trait) {
      continue;
    }

    try {
      var schema = JSON.parse(trait.request.queryString);
      for (var p in schema.properties) {
        // only add it if we didn't already explicitly define it in the operation
        if (!_.find(existingParams, {name: p, in: 'query'})) {
          params.push({
            $ref: '#/parameters/' + stringHelper.computeTraitName(trait.name, p)
          });
        }
      }
    } catch (e) {}

    try {
      var schema = JSON.parse(trait.request.headers);
      for (var p in schema.properties) {
        // only add it if we didn't already explicitly define it in the operation
        if (!_.find(existingParams, {name: p, in: 'header'})) {
          params.push({
            $ref: '#/parameters/' + stringHelper.computeTraitName(trait.name, p)
          });
        }
      }
    } catch (e) {}
  }

  return params;
};

Swagger.prototype._mapEndpointTraitResponses = function (endpoint) {
  if (!endpoint.traits || !endpoint.traits.length) {
    return [];
  }

  var result = {};
  for (var i in endpoint.traits) {
    var trait = _.find(this.project.Traits, ['_id', endpoint.traits[i]]);
    if (!trait) {
      continue;
    }

    for(var i in trait.responses) {
      var res = trait.responses[i],
          code = (res.codes && res.codes.length > 0 && parseInt(res.codes[0]) ? res.codes[0] : 'default');

      result[code] = {
        $ref: '#/responses/' + stringHelper.computeTraitName(trait.name, code)
      };
    }
  }

  return result;
};

Swagger.prototype._mapEndpoints = function (swaggerDef, env) {
  var endpoints = this.project.Endpoints;
  for(var i in endpoints) {
    var endpoint = endpoints[i], parameters = [];

    if (!swaggerDef.paths[endpoint.Path]) {
      swaggerDef.paths[endpoint.Path] = {
         parameters: this._validateParameters(this._mapURIParams(endpoint.PathParams))
      };
    }
    parameters = parameters.concat(this._mapQueryString(endpoint.QueryString));
    parameters = parameters.concat(this._mapRequestBody(endpoint.Body));
    parameters = parameters.concat(this._mapRequestHeaders(endpoint.Headers));
    parameters = parameters.concat(this._mapEndpointTraitParameters(endpoint, parameters));
    parameters = this._validateParameters(parameters);

    var responses = _.assign({}, this._mapEndpointTraitResponses(endpoint), this._mapResponseBody(endpoint.Responses));
    swaggerDef.paths[endpoint.Path][endpoint.Method] = this._constructSwaggerMethod(endpoint, parameters, responses, env);
    //Is it OK to include produces/consumes in all cases?

    var security = [];
    if (endpoint.SecuredBy) {
      var security = this._mapEndpointSecurity(endpoint.SecuredBy, this.project.Environment.SecuritySchemes);
      if (Array.isArray(security) && security.length > 0) {
        swaggerDef.paths[endpoint.Path][endpoint.Method]['security'] = security;
      }
    }
  }
};

Swagger.prototype._mapTraitParameters = function (traits) {
  var parameters = {};

  for (var i in traits) {
    var trait = traits[i],
        params = [];

    try {
      var schema = JSON.parse(trait.request.queryString);
      if (!jsonHelper.isEmptySchema(schema)) {
        params = params.concat(this._validateParameters(this._mapQueryString(schema)));
      }
    } catch(e) {}

    try {
      var schema = JSON.parse(trait.request.headers);
      if (!jsonHelper.isEmptySchema(schema)) {
        params = params.concat(this._validateParameters(this._mapRequestHeaders(schema)));
      }
    } catch(e) {}

    for (var p in params) {
      var param = params[p];
      parameters[stringHelper.computeTraitName(trait.name, param.name)] = param;
    }
  }

  return parameters;
};

Swagger.prototype._mapTraitResponses = function (traits) {
  var responses = {};

  for (var i in traits) {
    var trait = traits[i];
    for(var i in trait.responses) {
      var res = trait.responses[i],
          item = mapResponseBody(res),
          responseName = stringHelper.computeTraitName(trait.name, (res.codes && res.codes.length > 0 && parseInt(res.codes[0]) ? res.codes[0] : 'default'));

      responses[responseName] = item;
    }
  }

  return responses;
};

Swagger.prototype._mapHostAndProtocol = function (env, swaggerDef) {
  var acceptedSchemes = ['http', 'https', 'ws', 'wss'];
  var hostUrl = url.parse(env.Host || '');
  var swaggerHost = hostUrl.hostname || '';
  if (swaggerHost && hostUrl.port) {
    swaggerHost = swaggerHost + ':' + hostUrl.port;
  }
  swaggerDef.Host = swaggerHost;

  if(Array.isArray(env.Protocols) && env.Protocols.length>0) {
    var filteredSchemes = [];
    env.Protocols.map(function(p){
      if (acceptedSchemes.indexOf(p.toLowerCase()) >= 0) {
        filteredSchemes.push(p.toLowerCase());
      }
    });
    swaggerDef.schemes = filteredSchemes;
  } else if(hostUrl.protocol) {
    swaggerDef.schemes = [hostUrl.protocol.split(':')[0]];
  } else {
    delete swaggerDef.schemes;
  }
};


Swagger.prototype._export = function () {
  //TODO
  var swaggerDef = new SwaggerDefinition(this.project.Name, this.project.Description);
  var env = this.project.Environment;
  swaggerDef.info.version = env.Version;
  swaggerDef.BasePath = env.BasePath || '';

  this._mapHostAndProtocol(env, swaggerDef);

  if(env.DefaultResponseType) {
    swaggerDef.produces = [env.DefaultResponseType];
  } else {
    delete swaggerDef.produces;
  }

  if(env.DefaultRequestType) {
    swaggerDef.consumes = [env.DefaultRequestType];
  } else {
    delete swaggerDef.consumes;
  }

  swaggerDef.definitions = this._mapSchema(this.project.Schemas);
  swaggerDef.parameters = this._mapTraitParameters(this.project.Traits);
  swaggerDef.responses = this._mapTraitResponses(this.project.Traits);
  swaggerDef.securityDefinitions = this._mapSecurityDefinitions(this.project.Environment.SecuritySchemes);

  this._mapEndpoints(swaggerDef, env);

  //if not security definition added, then don't keep the field anymore
  if (swaggerDef.securityDefinitions && Object.keys(swaggerDef.securityDefinitions).length <= 0) {
    delete swaggerDef['securityDefinitions'];
  }
  this.data = jsonHelper.toJSON(swaggerDef);
};

module.exports = Swagger;
