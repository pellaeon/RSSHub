const got = require('@/utils/got');
const cheerio = require('cheerio');
const URL = require('url');

const fetchWithCache = async (url, cacheKey, cache) => {
    return cache.tryGet(cacheKey, async () => {
        const response = await got.get(url);
        return response;
    });
};

/*
const filterBigImage = async (description_el) => {
	const new_description = $(description_el).find('figure.paragraph-image').each(function(i, el) {
		const img = $(el).find('noscript img');
		$(el).children().first().replaceWith(img);
	});
	return new_description.html();
};*/

module.exports = async (ctx) => {
    const { id } = ctx.params;
    const pageId = encodeURIComponent(id);
    const linkPath = `/@${pageId}`;
    const url = `https://medium.com${linkPath}`;

    const response = await got.get(url);
	const redirectedUrl = response.redirectUrls[0] || url;
    const $ = cheerio.load(response.data);

    const titleLinks = $('h1 > a');

    const items = await Promise.all(
		titleLinks.map(async function (i, el) {
            /*
		const test1 = $(el).parent('section').find('figure.paragraph-image').each(function(i, el) {
			console.log($(el).find('noscript img'));
		}).html();
		const new_description = $(el).parent('section').find('figure.paragraph-image').each(function(i, el) {
			const img = $(el).find('noscript img');
			if ( img.length > 0 ) {
				$(el).children().first().replaceWith(img);
				console.log($(el).children().first());
			} else {
				console.log($(el).find('noscript'));
			}
		}).html();
		*/
			var link = $(el).attr('href');
			var urlo = URL.parse(link);
			if ( link.startsWith('/') ) {
				link = URL.resolve(redirectedUrl, link);
			}
			const articleResponse = await got.get(link);
			const $a = cheerio.load(articleResponse.data);
            //const new_description = $(el).parents('section').html();
            return {
                title: $a('h1').first().text(),
                link: link,
                description: $a('article').html(),
            };
        })
        .toArray()
	);
	console.log(items);

    ctx.state.data = {
        title: $('[aria-label="Author Homepage"]').text(),
        link: `https://medium.com/@${pageId}`,
        description: '',
        item: items.filter((item) => !!item),
    };
};
