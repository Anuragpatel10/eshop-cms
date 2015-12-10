NEWSCHEMA('Product').make(function(schema) {

	schema.define('id', 'String(10)');
	schema.define('pictures', '[String]');
	schema.define('reference', 'String(20)');
	schema.define('category', 'String(300)', true);
	schema.define('manufacturer', 'String(50)');
	schema.define('name', 'String(50)', true);
	schema.define('search', 'String(80)', true);
	schema.define('price', Number, true);
	schema.define('body', String, true);
	schema.define('istop', Boolean);
	schema.define('linker', 'String(50)');
	schema.define('linker_category', 'String(300)');
	schema.define('linker_manufacturer', 'String(50)');
	schema.define('datecreated', Date);

	// Sets default values
	schema.setDefault(function(name) {
		switch (name) {
			case 'datecreated':
				return new Date();
		}
	});

	// Gets listing
	schema.setQuery(function(error, options, callback) {

		// options.search {String}
		// options.category {String}
		// options.page {String or Number}
		// options.max {String or Number}
		// options.id {String}

		options.page = U.parseInt(options.page) - 1;
		options.max = U.parseInt(options.max, 20);

		if (options.id && typeof(options.id) === 'string')
			options.id = options.id.split(',');

		if (options.page < 0)
			options.page = 0;

		var take = U.parseInt(options.max);
		var skip = U.parseInt(options.page * options.max);

		var sql = DB(error);
		var filter = sql.$; // Creates new SQLBuilder

		filter.where('isremoved', false);

		if (options.category) {
			filter.scope(function() {
				filter.where('linker_category', options.category);
				filter.or();
				// + all subcategories
				filter.query('SUBSTRING(linker_category, 0, ' + (options.category.length + 2) + ')=' + filter.escape(options.category + '/'));
			});
		}

		if (options.manufacturer)
			filter.where('linker_manufacturer', options.manufacturer);

		if (options.search)
			filter.like('search', options.search.toSearch(), '*');
		if (options.id)
			filter.in('id', options.id);
		if (options.skip)
			filter.where('id', '<>', options.skip);

		sql.select('items', 'tbl_product').make(function(builder) {
			builder.replace(filter);
			builder.sort('datecreated', true);
			builder.fields('id', 'pictures', 'name', 'linker', 'linker_category', 'category', 'istop', 'price', 'manufacturer');
			builder.skip(skip);
			builder.take(take);

			if (options.homepage)
				builder.sort('istop', true);
		});

		sql.count('count', 'tbl_product', 'id').make(function(builder) {
			builder.replace(filter);
		});

		sql.exec(function(err, response) {

			if (err)
				return callback();

			for (var i = 0, length = response.items.length; i < length; i++) {
				if (response.items[i].pictures)
					response.items[i].pictures = response.items[i].pictures.split(',');
				else
					response.items[i].pictures = new Array(0);
			}

			var data = {};
			data.count = response.count;
			data.items = response.items;
			data.pages = Math.ceil(response.count / options.max);

			if (data.pages === 0)
				data.pages = 1;

			data.page = options.page + 1;
			callback(data);
		});
	});

	// Saves the product into the database
	schema.setSave(function(error, model, options, callback) {

		// Default values
		model.linker = ((model.reference ? model.reference + '-' : '') + model.name).slug();
		model.search = (model.name + ' ' + model.reference).toSearch();
		model.linker_manufacturer = model.manufacturer ? model.manufacturer.slug() : '';

		var category = prepare_subcategories(model.category);

		model.linker_category = category.linker;
		model.category = category.name;

		var sql = DB(error);
		var isNew = model.id ? false : true;
		var clean = model.$clean();

		// Prepares properties
		clean.pictures = clean.pictures.join(',');

		if (isNew)
			model.id = clean.id = U.GUID(10);

		sql.save('item', 'tbl_product', isNew, function(builder, isNew) {
			builder.set(clean);
			if (isNew)
				return;
			builder.rem('id');
			builder.rem('datecreated');
			builder.where('id', clean.id);
		});

		sql.exec(function(err) {
			// Returns response
			callback(SUCCESS(true));

			// Refreshes internal information e.g. categories
			setTimeout(refresh, 1000);
		});
	});

	// Gets a specific product
	schema.setGet(function(error, model, options, callback) {

		// options.category {String}
		// options.linker {String}
		// options.id {String}

		var sql = DB(error);

		sql.select('item', 'tbl_product').make(function(builder) {
			builder.where('isremoved', false);
			if (options.category)
				builder.where('linker_category', options.category);
			if (options.linker)
				builder.where('linker', options.linker);
			if (options.id)
				builder.where('id', options.id);
			builder.first();
		});

		sql.validate('item', 'error-404-product');
		sql.exec(function(err, response) {
			if (err)
				return callback();

			// Parse pictures as array
			response.item.pictures = response.item.pictures.split(',');
			callback(response.item);
		});
	});

	// Removes product
	schema.setRemove(function(error, id, callback) {

		var sql = DB(error);

		sql.update('item', 'tbl_product').make(function(builder) {
			builder.where('id', id);
			builder.set('isremoved', true);
		});

		sql.exec(function() {
			// Refreshes internal information e.g. categories
			setTimeout(refresh, 1000);
			callback(SUCCESS(true));
		});
	});

	// Clears product database
	schema.addWorkflow('clear', function(error, model, options, callback) {
		var sql = DB(error);
		sql.remove('tbl_product');
		sql.exec(function() {
			// Refreshes internal information e.g. categories
			setTimeout(refresh, 1000);
			callback(SUCCESS(true));
		});
	});

	// Refreshes categories
	schema.addWorkflow('refresh', function(error, model, options, callback) {
		refresh();
		callback(SUCCESS(true));
	});

	// Replaces category
	schema.addWorkflow('category', function(error, model, options, callback) {

		// options.category_old
		// options.category_new

		var is = false;
		var sql = DB(error);
		var category_old = prepare_subcategories(options.category_old);
		var category_new = prepare_subcategories(options.category_new);

		// @TODO: add replacement subcategories
		sql.update('tbl_product').make(function(builder) {
			builder.set('category', category_new.name);
			builder.set('linker_category', category_new.linker);
			builder.where('category', category_old.name);
		});

		sql.exec(function() {
			// Refreshes internal information e.g. categories
			setTimeout(refresh, 1000);
			callback(SUCCESS(true));
		});
	});

	// Imports CSV
	schema.addWorkflow('import.csv', function(error, model, filename, callback) {
		require('fs').readFile(filename, function(err, buffer) {

			if (err) {
				error.push(err);
				callback();
				return;
			}

			buffer = buffer.toString('utf8').split('\n');

			var properties = [];
			var schema = GETSCHEMA('Product');
			var isFirst = true;
			var count = 0;

			buffer.wait(function(line, next) {

				if (!line)
					return next();

				var data = line.replace(/\"/g, '').split(';')
				var product = {};

				for (var i = 0, length = data.length; i < length; i++) {
					var value = data[i];
					if (!value)
						continue;

					if (isFirst)
						properties.push(value);
					else
						product[properties[i]] = value;
				}

				if (isFirst) {
					isFirst = false;
					return next();
				}

				schema.make(product, function(err, model) {
					if (err)
						return next();
					count++;
					model.$save(next);
				});
			}, function() {

				if (count)
					refresh();

				// Done, returns response
				callback(SUCCESS(count > 0));
			});
		});
	});

	// Imports XML
	schema.addWorkflow('import.xml', function(error, model, filename, callback) {

		var products = [];
		var count = 0;
		var stream = require('fs').createReadStream(filename);

		stream.on('data', U.streamer('</product>', function(value) {

			var index = value.indexOf('<product>');
			if (index === -1)
				return;

			value = value.substring(index).trim();
			xml = value.parseXML();

			var obj = {};

			Object.keys(xml).forEach(function(key) {
				obj[key.replace('product.', '')] = xml[key];
			});

			products.push(obj);
		}));

		CLEANUP(stream, function() {
			products.wait(function(product, next) {
				schema.make(product, function(err, model) {
					if (err)
						return next();
					count++;
					model.$save(next);
				});
			}, function() {

				if (count)
					refresh();

				// Done, returns response
				callback(SUCCESS(count > 0));
			});
		});
	});

});

// Refreshes internal information (categories)
function refresh() {

	var sql = DB();

	sql.select('categories', 'tbl_product').make(function(builder) {
		builder.where('isremoved', false);
		builder.where('linker_category', '<>', '');
		builder.fields('category as name', 'linker_category as linker', '!COUNT(id) as count --> number');
		builder.group(['category', 'linker_category']);
	});

	sql.select('manufacturers', 'tbl_product').make(function(builder) {
		builder.where('isremoved', false);
		builder.where('linker_manufacturer', '<>', '');
		builder.fields('manufacturer as name', 'linker_manufacturer as linker', '!COUNT(id) as count --> number');
		builder.group(['manufacturer', 'linker_manufacturer']);
		builder.sort('manufacturer');
	});

	sql.exec(function(err, response) {

		// Prepares categories with their subcategories
		var categories = [];
		var categories_filter = {};

		for (var i = 0, length = response.categories.length; i < length; i++) {

			var item = response.categories[i];
			item.path = item.linker.split('/');
			item.names = item.name.split('/').trim();

			item.path.forEach(function(path, index) {
				var key = item.path.slice(0, index + 1).join('/');

				if (categories_filter[key]) {
					categories_filter[key].count += item.count;
					return;
				}

				var obj = {};
				obj.linker = key;
				obj.name = item.names.slice(0, index + 1).join(' / ');
				obj.count = item.count;
				obj.text = item.names[index];
				obj.parent = item.path.slice(0, index).join('/');
				obj.level = index;
				categories_filter[key] = obj;
			});
		}

		Object.keys(categories_filter).forEach(function(key) {
			categories.push(categories_filter[key]);
		});

		categories.sort(function(a, b) {
			if (a.level > b.level)
				return 1;
			return a.level < b.level ? -1 : 0;
		});

		F.global.categories = categories;
		F.global.manufacturers = response.manufacturers;
	});
}

function prepare_subcategories(name) {

	var builder_link = [];
	var builder_text = [];
	var category = name.split('/');

	for (var i = 0, length = category.length; i < length; i++) {
		var item = category[i].trim();
		builder_link.push(item.slug());
		builder_text.push(item);
	}

	return { linker: builder_link.join('/'), name: builder_text.join(' / ') };
}

setTimeout(refresh, 1000);