module.exports = {
  schema: true,
  primaryKey: 'pet_id',
  attributes: {
    pet_id: {
      type: 'integer',
      autoIncrement: true
    },
    name: 'string',
    owner: {
      model: 'user'
    },
    bestFriend: {
      model: 'user'
    },
    parents: {
      collection: 'pet',
      via: 'children'
    },
    children: {
      collection: 'pet',
      via: 'parents'
    },
    bestFurryFriend: {
      model: 'pet'
    },
    vets: {
      collection: 'user',
      via: 'patients'
    },
    isPet: {
      type: 'boolean',
      defaultsTo: true
    }
  }
};
