const got = require('@/utils/got');
const logger = require('@/utils/logger');
const { parseDate } = require('@/utils/parse-date');
const cheerio = require('cheerio');
const fs = require('fs/promises');
const path = require('path');

const fetchCookie = async () => {
    const url = 'https://mbasic.facebook.com/';
    const response = await got.get(url, {
        headers: {
            "User-Agent": "curl",
        }
    });
    // Turns out remembering the cookie will allow more requests to be made before rate limit is reached
    let cookie;
    if ('set-cookie' in response.headers) {
        cookie = response.headers['set-cookie'].join(' ');
    } else {
        cookie = response.headers['Set-Cookie'].join(' ');
    }
    const datr = cookie.match(/datr=(\S+);/)[1];
    const sb = cookie.match(/sb=(\S+);/)[1];
    return `datr=${datr}; sb=${sb};`;
};

const fetchPageHtml = async (linkPath, cacheKey, cache, cookie) => {
    const url = `https://mbasic.facebook.com${linkPath}`;

    return cache.tryGet(cacheKey, async () => {
        const { data: html } = await got.get(url, {
            headers: {
                Cookie: cookie,
            },
        });
        return html;
    });
};

// Download images from facebook CDN and store it in /var/www/rsshub/pics
// because the img src served from mbasic will expire in a few days
const savePic = async (linkPath, picurl) => {
    if ( ! picurl || !process.env.NODE_NAME ) return null;
    const response = await got.get(picurl);
    var url1 = new URL(picurl);
    const now = new Date();
    var filedir = path.resolve('/var/www/rsshub/pics', path.basename(linkPath), now.toISOString().split('T')[0]);
    await fs.mkdir(filedir, {recursive: true});
    const filename = path.basename(url1.pathname);
    const filepath = path.resolve(filedir, filename);
    const retpath = path.join(path.basename(linkPath), now.toISOString().split('T')[0], filename);
    const returl = 'https://'+process.env.NODE_NAME + '/pics/'+retpath;
    await fs.writeFile(filepath, response.rawBody);
    return returl;
};

const fetchPageHtml2 = async (linkPath, cacheKey, cache, cookie) => {
    const url = `https://mbasic.facebook.com${linkPath}`;

    const html = cache.get(cacheKey);
    if (!html) {
        const response = await got.get(url, {
            followRedirect: false,
            headers: {
                'Accept-Language': 'en',
                'Cookie': cookie
            }
        });
        if (response.statusCode == 302) {
            cache.set(cacheKey, '', 1);// delete item from cache, ref: lib/middleware/cache/memory.js
            return null;
        } else {
            return response.data;
        }
    }
};

const parseStoryPage = async (linkPath, cache, cookie) => {
    const { searchParams: q } = new URL('https://mbasic.facebook.com' + linkPath);
    const storyFbId = q.get('story_fbid');
    const storyId = q.get('id');
    const cacheKey = `story/${storyFbId}/${storyId}`;

    const html = await fetchPageHtml2(linkPath, cacheKey, cache, cookie);
    if (html === null) {
        logger.warn('Facebook required login to '+'https://mbasic.facebook.com'+linkPath);
        return null;
    }
    const $ = cheerio.load(html);

    //const url = `https://www.facebook.com/story.php?story_fbid=${storyFbId}&id=${storyId}`;
    const url = $('link[rel="canonical"]').attr('href');
    const $story = $('#m_story_permalink_view').eq(0);
    const $box = $story.find('.bv').eq(0);
    const $header = $box.find('header').eq(0);
    const $content = $box.find('div > div').eq(0);
    $content.find('a[href^="https://lm.facebook.com/l.php"]').each((_, ele) => {
        const link = $(ele);
        const originalLink = new URL(link.attr('href')).searchParams.get('u');
        if (originalLink) {
            link.attr('href', decodeURIComponent(originalLink));
        }
    });
    const $attach = $story.find('div > div > div > div:nth-child(3)').eq(0);
    const $date = $story.find('footer abbr').eq(0);

    const attachLinkList = $attach
        .find('a')
        .toArray()
        .map((a) => $(a).attr('href'));
    const isAttachAreImageSet = attachLinkList.filter((link) => new RegExp('/photos/').test(link)).length === attachLinkList.length;
    const title = $header.find('h3').text();

    const content = $content.html();
    const date = parseDate($date.text(), 'MMMM D at h:mm A');

    let images = [];
    if (isAttachAreImageSet) {
        images = await Promise.all(attachLinkList.map((link) => parsePhotoPage(link, cache)));
    }

    return {
        url,
        title,
        date,
        content,
        images,
    };
};

const parsePhotoPage = async (linkPath, cache, cookie) => {
    const { pathname } = new URL('https://mbasic.facebook.com' + linkPath);
    const cacheKey = `photos${pathname}`;

    const html = await fetchPageHtml2(linkPath, cacheKey, cache, cookie);
    if (html === null) {
        logger.warn('Facebook required login to '+'https://mbasic.facebook.com'+linkPath);
        return null;
    }
    const $ = cheerio.load(html);

    const title = $('#MPhotoContent div.msg > a > strong').first().text();
    //const url = `https://www.facebook.com${pathname}`;
    const url = $('link[rel="canonical"]').attr('href');
    const $content = $('#MPhotoContent div.msg > div');
    const content = $content.html();
    const image_main = $('#MPhotoContent div.desc.attachment > span > div > span > a[target=_blank].sec').attr('href');
    const image_hires = $('#MPhotoContent div.desc.attachment a[href^="https"]').attr('href');
    const image = image_hires || image_main;
    const $date = $('.desc abbr').eq(0);
    var date = parseDate($date.text(), 'MMM D');
    const current_date = new Date();
    if ( current_date < date ) {
        date.setFullYear(current_date.getFullYear() -1);
        console.log(date);
    }

    return {
        title,
        date,
        url,
        content,
        image,
    };
};

module.exports = async (ctx) => {
    const { id } = ctx.params;
    const pageId = encodeURIComponent(id);
    const linkPath = `/${pageId}`;

    const cookie = await fetchCookie();
    const html = await fetchPageHtml2(linkPath, pageId, ctx.cache, cookie);
    const $ = cheerio.load(html);
    const ifUserPage = $('#timelineBody > table').text().includes('Friends');
    if ( ifUserPage ) {
        throw new Error('This is an user page, could not crawl');
    }

    var itemLinks = $('footer > div:nth-child(2) > a:nth-child(1)')
        .toArray()
        .map((a) => $(a).attr('href'));
    if ( itemLinks.length === 0 ) {
        itemLinks = $('#timelineBody a')
        .toArray()
        .filter((a) => a.innerText == 'Full Story');
        logger.debug(itemLinks);
    }
    if ( itemLinks.length === 0 ) {
        throw new Error('Unable to fetch posts');
    }

    const items = await Promise.all(
        itemLinks.map(async (itemLink) => {
            if (/^\/.+\/photos\//.test(itemLink)) {
                var data = await parsePhotoPage(itemLink, ctx.cache, cookie);
                var savedpath = null;
                if ( data && data.image) {
                    savedpath = await savePic(linkPath, data.image);
                } else if ( ! data ) {
                    data = { image: '' };
                }
                return {
                    title: data ? data.title : null,
                    link: data ? data.url : null,
                    pubDate: data ? data.date : null,
                    description: savedpath ? `<img src="${savedpath}" data-original="${data.image}"><br>${data.content}` :
                    `<img src="${data.image}"><br>${data.content}`,
                    enclosure_url: savedpath ? `${savedpath}` : data.image,
                };
            }
            if (new RegExp(`^/story.php`).test(itemLink)) {
                const data = await parseStoryPage(itemLink, ctx.cache, cookie);
                if (data === null) {
                    return null;
                }
                const isSingleImageStory = data.images.length === 1;
                const isEmptyImageList = data.images.length === 0;

                let desc = '';
                var img_els = data.images.map(async (image) => {
                    var savedpath = null;
                    if ( image && image.image) { savedpath = await savePic(linkPath, image.image); }
                    return savedpath ? `<img src="${savedpath}" data-original="${image.image}"><br>${image.content}` :
                    `<img src="${image.image}"><br>${image.content}`;
                });
                desc += (await Promise.all(img_els)).join('<br>');
                if (!isSingleImageStory) {
                    !isEmptyImageList && (desc += '<br>');
                    desc += data.content;
                }
                if (data.url == null || data.url == "") {
                    console.log(itemLink);
                }

                var enclosure_url = null;
                if ( data.images && data.images[0] && data.images[0].image ) {
                    enclosure_url = savedpath ? savedpath : data.images[0].image;
                }

                return {
                    title: data.title,
                    link: data.url,
                    enclosure_url,
                    pubDate: data.date,
                    description: desc,
                };
            }
        })
    );

    ctx.state.data = {
        title: $('#m-timeline-cover-section h1 span').text(),
        link: `https://www.facebook.com/${pageId}`,
        description: $('#sub_profile_pic_content>div>div:nth-child(3) div>span').find('br').replaceWith('\n').text(),
        item: items.filter((item) => !!item),
    };
};
