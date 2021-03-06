/**
 * Module dependencies
 */

var actionUtil = require('../actionUtil');
var _ = require('@sailshq/lodash');
var async = require('async');

/**
 * Add Record To Collection
 *
 * http://sailsjs.com/docs/reference/blueprint-api/add-to
 *
 * Associate one record with the collection attribute of another.
 * e.g. add a Horse named "Jimmy" to a Farm's "animals".
 * If the record being added has a primary key value already, it will
 * just be linked.  If it doesn't, a new record will be created, then
 * linked appropriately.  In either case, the association is bidirectional.
 *
 */

module.exports = function addToCollection (req, res) {

  // Ensure a model and alias can be deduced from the request.
  var Model = actionUtil.parseModel(req);
  var relation = req.options.alias;
  if (!relation) {
    return res.serverError(new Error('Missing required route option, `req.options.alias`.'));
  }

  // The primary key of the parent record
  var parentPk = req.param('parentid');

  // Get the model class of the child in order to figure out the name of
  // the primary key attribute.
  var associationAttr = _.findWhere(Model.associations, { alias: relation });
  var ChildModel = req._sails.models[associationAttr.collection];
  var childPkAttr = ChildModel.primaryKey;


  // The child record to associate is defined by either...
  var child;

  // ...a primary key:
  var supposedChildPk = actionUtil.parsePk(req);
  if (supposedChildPk) {
    child = {};
    child[childPkAttr] = supposedChildPk;
  }
  // ...or an object of values:
  else {
    req.options.values = req.options.values || {};
    req.options.values.blacklist = req.options.values.blacklist || ['limit', 'skip', 'sort', 'id', 'parentid'];
    child = actionUtil.parseValues(req);
  }

  if (!child) {
    res.badRequest('You must specify the record to add (either the primary key of an existing record to link, or a new object without a primary key which will be used to create a record then link it.)');
  }


  var createdChild = false;

  async.auto({

    // Look up the parent record
    parent: function (cb) {
      Model.findOne(parentPk).exec(function foundParent(err, parentRecord) {
        if (err) { return cb(err); }
        if (!parentRecord) { return cb({status: 404}); }
        return cb(null, parentRecord);
      });
    },

    // If a primary key was specified in the `child` object we parsed
    // from the request, look it up to make sure it exists.  Send back its primary key value.
    // This is here because, although you can do this with `.save()`, you can't actually
    // get ahold of the created child record data, unless you create it first.
    actualChildPkValue: ['parent', function(results, cb) {

      // Below, we use the primary key attribute to pull out the primary key value
      // (which might not have existed until now, if the .add() resulted in a `create()`)

      // If the primary key was specified for the child record, we should try to find
      // it before we create it.
      if (child[childPkAttr]) {
        ChildModel.findOne(child[childPkAttr]).exec(function foundChild(err, childRecord) {
          if (err) { return cb(err); }
          // Didn't find it?  Then try creating it.
          if (!childRecord) {return createChild();}
          // Otherwise use the one we found.
          return cb(null, childRecord[childPkAttr]);
        });
      }
      // Otherwise, it must be referring to a new thing, so create it.
      else {
        return createChild();
      }

      // Create a new instance and send out any required pubsub messages.
      function createChild() {
        ChildModel.create(child).meta({fetch: true}).exec(function createdNewChild (err, newChildRecord){
          if (err) { return cb(err); }
          if (req._sails.hooks.pubsub) {
            if (req.isSocket) {
              ChildModel.subscribe(req, [newChildRecord[ChildModel.primaryKey]]);
              ChildModel._introduce(newChildRecord);
            }
            ChildModel._publishCreate(newChildRecord, !req.options.mirror && req);
          }

          createdChild = true;
          return cb(null, newChildRecord[childPkAttr]);
        });
      }

    }]
  },

  // Save the parent record
  function readyToSave (err, async_data) {

    if (err) {
      // If this is a usage error coming back from Waterline,
      // (e.g. a bad criteria), then respond w/ a 400 status code.
      // Otherwise, it's something unexpected, so use 500.
      switch (err.name) {
        case 'UsageError': return res.badRequest(err);
        default: return res.serverError(err);
      }
    }//-•
    Model.addToCollection(parentPk, relation, async_data.actualChildPkValue).exec( function(err) {

      // Ignore `insert` errors for duplicate adds
      // (but keep in mind, we should not _publishAdd if this is the case...)
      var isDuplicateInsertError = (err && typeof err === 'object' && err.length && err[0] && err[0].type === 'insert');
      if (err && !isDuplicateInsertError) {
        // If this is a usage error coming back from Waterline,
        // (e.g. a bad criteria), then respond w/ a 400 status code.
        // Otherwise, it's something unexpected, so use 500.
        switch (err.name) {
          case 'UsageError': return res.badRequest(err);
          default: return res.serverError(err);
        }
      }

      // Only broadcast an update if this isn't a duplicate `add`
      // (otherwise connected clients will see duplicates)
      if (!isDuplicateInsertError && req._sails.hooks.pubsub) {

        // Subscribe to the model you're adding to, if this was a socket request
        if (req.isSocket) { Model.subscribe(req, [async_data.parent[Model.primaryKey]]); }
          // Publish to subscribed sockets
        Model._publishAdd(async_data.parent[Model.primaryKey], relation, async_data.actualChildPkValue, !req.options.mirror && req, {noReverse: createdChild});
      }

      // Finally, look up the parent record again and populate the relevant collection.
      var query = Model.findOne(parentPk);
      query = actionUtil.populateRequest(query, req);
      query.exec(function(err, matchingRecord) {
        if (err) { return res.serverError(err); }
        if (!matchingRecord) { return res.serverError(); }
        if (!matchingRecord[relation]) { return res.serverError(); }
        return res.ok(matchingRecord);
      });
    });

  }); // </async.auto>
};
