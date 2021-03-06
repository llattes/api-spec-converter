var parser = require('raml-parser'),
    Endpoint = require('../entities/endpoint'),
    Schema = require('../entities/schema'),
    Importer = require('./importer'),
    Project = require('../entities/project'),
    jsonHelper = require('../utils/json'),
    url = require('url'),
    Validator = require('jsonschema').Validator,
    _ = require('lodash');

//TODO multi file support isn't justified

function RAML() {
  this.schemas = [];
}
RAML.prototype = new Importer();

RAML.prototype._getSecuritySchemeSettingsByName = function(schemeName) {
  for(var i in this.data.securitySchemes) {
    var securityScheme = this.data.securitySchemes[i];
    for (var name in securityScheme) {
      if (name === schemeName) {
        return securityScheme[name];
      }
    }
  }
};

RAML.prototype._mapSecuritySchemes = function (securitySchemes) {
  var slSecurityScheme = {};
  for(var i in securitySchemes) {
    var securityScheme = securitySchemes[i];
    for (var name in securityScheme) {
      var scheme = securityScheme[name];
      switch(scheme.type) {
        case 'OAuth 2.0':
          var oauth = {
            name: name, //not used in stoplight designer
            authorizationUrl: scheme.settings.authorizationUri || '',
            tokenUrl: scheme.settings.accessTokenUri || '',
            scopes: []
          };
          if (Array.isArray(scheme.scopes)) {
            for(var scopeIndex in scheme.scopes) {
              oauth.scopes.push({
                name: scheme.scopes[scopeIndex],
                value: ''
              });
            }
          }
          //authorizationGrants are flow, only one supported in stoplight
          var flow = Array.isArray(scheme.settings.authorizationGrants) &&
                      scheme.settings.authorizationGrants.length > 0? scheme.settings.authorizationGrants[0]:'code';

          switch(flow) {
            case 'code':
              oauth.flow = 'accessCode';
              break;
            case 'token':
              oauth.flow = 'implicit';
              break;
            case 'owner':
              oauth.flow = 'application';
              break;
            case 'credentials':
              oauth.flow = 'password';
              break;
          }
          slSecurityScheme['oauth2'] = oauth;
          break;
        case 'Basic Authentication':
          slSecurityScheme['basic'] = {
            name: name,
            value: '',
            description: scheme.description || ''
          };
          break;
        default:
          //TODO not supported
      }
    }
  }
  return slSecurityScheme;
};

RAML.prototype._mapRequestBody = function (methodBody) {
  var data = {mimeType: '', body: {}, example: ''};

  //TODO: only one, the latest is in effect in stoplight!
  for (var mimeType in methodBody) {
    if (!methodBody[mimeType]) {
      continue;
    }
    data.mimeType = mimeType;

    if (methodBody[mimeType].example) {
      data.example = methodBody[mimeType].example;
    }

    if (methodBody[mimeType].schema) {
      var definition = jsonHelper.parse(methodBody[mimeType].schema);
      data.body = definition;
    }
    else if (methodBody[mimeType].formParameters) {
      data.body = {
          type: 'object',
          'properties': {},
          'required': []
      };
      var formParams = methodBody[mimeType].formParameters;
      for (var param in formParams) {
        data.body.properties[param] = {
          type: formParams[param].type
        };
        if (formParams[param].description) {
          data.body.properties[param].description = formParams[param].description;
        }
        if (formParams[param].required) {
          data.body.required.push(param);
        }
      }
    }
  }

  return data;
};

RAML.prototype._mapQueryString = function(queryParameters) {
  var queryString = {type:'object', properties: {}, required: []};
  for (var key in queryParameters) {
    queryString.properties[key] = queryParameters[key];
    if (queryParameters[key].description) {
      queryString.properties[key].description = queryParameters[key].description;
    }
    if (queryParameters[key].required) {
      queryString.required.push(key);
    }
  }
  return queryString;
};

RAML.prototype._mapRequestHeaders = function (data) {
  return this._mapQueryString(data);
};

RAML.prototype._mapURIParams = function (uriParams) {
  var pathParams = {type:'object', properties: {}, required: []};
  for (var key in uriParams) {
    pathParams.properties[key] = {
      description: uriParams[key].displayName || uriParams[key].description || '',
      type: uriParams[key].type || 'string'
    };
  }
  return pathParams;
};

RAML.prototype._mapResponseBody = function(response) {
  var data = [];
  for(var code in response) {
    if (!response[code] || !response[code].body) {
      continue;
    }
    var result = this._mapRequestBody(response[code].body);
    result.codes = [parseInt(code)];
    result.body = jsonHelper.stringify(result.body, 4);
    if(response[code].description) {
      result.description = response[code].description;
    }
    data.push(result);
  }
  return data;
};

RAML.prototype._mapSchema = function(schemData) {
  var schemas = [];
  for (var i in schemData) {
    for (var schemaName in schemData[i]) {
      var sd = new Schema(schemaName);
      sd.Name = schemaName;
      sd.Definition = schemData[i][schemaName];
      schemas.push(sd);
    }
  }
  return schemas;
};


RAML.prototype._mapEndpoint = function(resource, baseURI, pathParams) {
  if(resource.uriParameters) {
    pathParams = _.merge(pathParams, this._mapURIParams(resource.uriParameters));
  }

  for (var i in resource.methods) {
    var method = resource.methods[i];
    var summary = '';
    if (method.summary) {
      summary = method.summary;
    }

    var endpoint = new Endpoint(summary);
    endpoint.Method = method.method;
    endpoint.Path = baseURI + resource.relativeUri;
    endpoint.Description = method.description;

    endpoint.SetOperationId(method.displayName, endpoint.Method, endpoint.Path);

    if (method.body) {
      endpoint.Body = this._mapRequestBody(method.body);
    }

    if (method.queryParameters) {
      endpoint.QueryString = this._mapQueryString(method.queryParameters);
    }

    if (method.headers) {
      endpoint.Headers = this._mapRequestHeaders(method.headers);
    }

    if (method.responses) {
      endpoint.Responses = this._mapResponseBody(method.responses);
    }

    endpoint.traits = [];
    if (method.is) {
      if (method.is instanceof Array) {
        endpoint.traits = method.is;
      } else if (method.is instanceof Object) {
        endpoint.traits = Object.keys(method.is);
      }
    }

    endpoint.PathParams = pathParams;

    //endpoint security
    if (Array.isArray(method.securedBy)) {
      endpoint.securedBy = {};
      for(var si in method.securedBy) {
        var schemeSettings = this._getSecuritySchemeSettingsByName(method.securedBy[si]);
        switch(schemeSettings.type) {
          case 'OAuth 2.0':
            endpoint.securedBy['oauth2'] = true;
            break;
          case 'Basic Authentication':
            endpoint.securedBy['basic'] = true;
            break;
          default:
            //TODO not supported
            break;
        }
      }
    }

    //TODO endpoint security

    this.project.addEndpoint(endpoint);
  }

  if(resource.resources && resource.resources.length > 0) {
    for (var i = 0; i < resource.resources.length; i++) {
      this._mapEndpoint(resource.resources[i], baseURI + resource.relativeUri, pathParams);
    }
  }
};

RAML.prototype.loadFile = function (filePath, cb) {
  var me = this;

  parser.loadFile(filePath).then(function(data) {
    me.data = data;
    cb();
  }, function(error) {
    cb(error);
  });
};


RAML.prototype.loadData = function (data) {
  var me = this;
  return new Promise(function(resolve, reject){
    parser.load(data)
    .then(function(data) {
      me.data = data;
      resolve();
    }, function(error) {
      reject(error);
    });
  });
};

RAML.prototype._mapHost = function() {
  var parsedURL = url.parse(this.data.baseUri || '');
  this.project.Environment.Host = (parsedURL.protocol && parsedURL.host)? (parsedURL.protocol + '//' + parsedURL.host) : null;
  this.project.Environment.BasePath = parsedURL.path;
};

RAML.prototype._mapTraits = function(traitGroups) {
  var slTraits = [];

  for (var i in traitGroups) {
    var traitGroup = traitGroups[i];

    for (var k in traitGroup) {
      var trait = traitGroup[k],
          slTrait = {
            _id: k,
            name: k,
            request: {},
            responses: []
          };

      if (trait.queryParameters) {
        slTrait.request.queryString = this._mapQueryString(trait.queryParameters);
      }

      if (trait.headers) {
        slTrait.request.headers = this._mapRequestHeaders(trait.headers);
      }

      if (trait.responses) {
        slTrait.responses = this._mapResponseBody(trait.responses);
      }

      slTraits.push(slTrait);
    }
  }

  return slTraits;
};

RAML.prototype._import = function() {
  this.project = new Project(this.data.title);

  //TODO set project description from documentation
  //How to know which documentation describes the project briefly?
  if (this.data.documentation && this.data.documentation.length > 0) {
    this.project.Description = this.data.documentation[0].content;
    this.project.Environment.summary = this.data.documentation[0].content;
  }

  this._mapHost();

  this.project.Environment.Protocols = this.data.protocols;
  this.project.Environment.DefaultResponseType = this.data.mediaType || '';
  this.project.Environment.DefaultRequestType = this.data.mediaType || '';
  this.project.Environment.Version = this.data.version;

  this.project.Environment.SecuritySchemes = this._mapSecuritySchemes(this.data.securitySchemes);

  for (var i = 0; i < this.data.resources.length; i++) {
    this._mapEndpoint(this.data.resources[i], '', {});
  }

  var schemas = this._mapSchema(this.data.schemas);
  for(var i in schemas) {
    this.project.addSchema(schemas[i]);
  }

  this.project.traits = this._mapTraits(this.data.traits);
};

module.exports = RAML;
