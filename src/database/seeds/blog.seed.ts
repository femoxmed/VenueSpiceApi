import { DataSource, Repository } from 'typeorm';
import { BlogEntity } from '../../blogs/entities/blog.entity';
import { ProductEntity } from '../../products/entities/product.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { Role } from '../../common/enums/role.enum';

type BlogSeed = {
	title: string;
	slug: string;
	excerpt: string;
	content: string;
	category: string;
	status: 'draft' | 'published';
	publishedAt: Date | null;
	featuredAt: Date | null;
};

const blogSeeds: BlogSeed[] = [
	{
		title: 'Why Better Water Changes the Rhythm of Your Day',
		slug: 'why-better-water-changes-the-rhythm-of-your-day',
		excerpt:
			'From the first glass in the morning to the final cup at night, dependable water quietly improves the routines that matter.',
		content: `Most conversations about wellbeing begin with ambitious changes. Better water asks for something simpler: improve the resource you reach for throughout the day.

When clean water is consistently available, hydration becomes less of a task. Morning routines move more easily, cooking feels more considered, and hosting no longer begins with wondering whether there is enough bottled water in the house.

The quality of water also shapes taste. Tea becomes clearer, coffee feels more balanced, and the natural character of fresh ingredients is easier to notice. These are modest differences, but they repeat every day.

A well-designed purification system should sit quietly within the home. It should be dependable, intuitive, and easy to maintain. The best technology supports daily life without asking to become the centre of it.

Better living is often built from small decisions made consistently. Choosing better water is one of the few that can touch nearly every hour of the day.`,
		category: 'Water & Wellness',
		status: 'published',
		publishedAt: new Date('2026-05-28T09:00:00.000Z'),
		featuredAt: new Date('2026-05-28T09:00:00.000Z'),
	},
	{
		title: 'Designing a Kitchen Around Everyday Ease',
		slug: 'designing-a-kitchen-around-everyday-ease',
		excerpt:
			'A beautiful kitchen works hardest in the details: clear surfaces, intuitive movement, and essentials placed exactly where they are needed.',
		content: `A kitchen can be visually impressive and still feel difficult to use. The spaces we enjoy most are designed around movement before decoration.

Start with the journeys repeated every day. Where do you fill a glass, prepare breakfast, wash produce, and make tea? Keeping those actions within a comfortable working zone reduces clutter and makes the room feel calmer.

Appliances deserve the same consideration. Choose pieces that earn their place through regular use, then give them enough room to work without dominating the counter. Integrated water systems are especially effective because they replace several temporary objects with one dependable source.

Materials matter, but restraint matters more. A limited palette allows texture, natural light, and thoughtfully selected objects to carry the room. The result feels intentional rather than overworked.

Good design is not only what a kitchen looks like when it is empty. It is how naturally the room supports a busy morning, a quiet evening, and a table full of people.`,
		category: 'Design & Living',
		status: 'published',
		publishedAt: new Date('2026-05-20T09:00:00.000Z'),
		featuredAt: new Date('2026-05-20T09:00:00.000Z'),
	},
	{
		title: 'A Practical Guide to Choosing a Home Water Purifier',
		slug: 'a-practical-guide-to-choosing-a-home-water-purifier',
		excerpt:
			'The right purifier depends on your water, household, available space, and the level of convenience you expect every day.',
		content: `Choosing a purifier should begin with your water source. Municipal supply, borehole water, and stored water can carry different concerns, so a useful recommendation depends on understanding what needs to be reduced or removed.

Next, consider household demand. A larger family or a home that hosts regularly will need stronger flow and capacity than a compact apartment. Hot and cold dispensing can also reduce the need for separate kettles, chillers, and bottled water storage.

Maintenance is part of the product, not an afterthought. Ask how often filters need changing, whether service is available locally, and how clearly the system communicates when attention is required.

Finally, think about placement. Measure the intended area, check access to power and water, and choose a finish that belongs naturally in the room.

The best purifier is not simply the model with the longest specification sheet. It is the one that matches your water conditions and becomes effortless to live with.`,
		category: 'Buying Guides',
		status: 'published',
		publishedAt: new Date('2026-05-12T09:00:00.000Z'),
		featuredAt: new Date('2026-05-12T09:00:00.000Z'),
	},
	{
		title: 'The Quiet Luxury of Being Prepared',
		slug: 'the-quiet-luxury-of-being-prepared',
		excerpt:
			'Real comfort often comes from systems that are maintained before they become urgent.',
		content: `There is a particular ease in knowing the essentials of a home are ready before they are needed.

Water systems reward this kind of attention. Regular filter changes protect performance, preserve taste, and help each internal component work as intended.

This article is being prepared by the Aquzera editorial team and will include a simple maintenance calendar for modern households.`,
		category: 'Care & Maintenance',
		status: 'draft',
		publishedAt: null,
		featuredAt: null,
	},
	{
		title: 'Five Simple Ways to Drink More Water Without Tracking It',
		slug: 'five-simple-ways-to-drink-more-water-without-tracking-it',
		excerpt:
			'Better hydration does not need another app. A few thoughtful changes to your environment can make it feel automatic.',
		content: `Hydration advice often begins with a target and a tracker. For many people, the easier approach is to shape the environment so drinking water becomes the natural next action.

Begin the day with water already within reach. A glass beside your breakfast place or a bottle near your workspace removes the small delay that turns intention into postponement.

Make the water enjoyable. Temperature matters, as does taste. When filtered water is consistently cold, clear, and pleasant, people reach for it more often without needing reminders.

Connect drinking water to routines that already exist. Have a glass after brushing your teeth, before each meal, and whenever you return home. Existing habits make reliable anchors.

Use a vessel you genuinely enjoy. A well-balanced glass or reusable bottle sounds insignificant, but objects that feel good to use are used more often.

Finally, keep access simple. The shorter the distance between wanting water and having it, the easier hydration becomes. Convenience is not laziness; it is thoughtful design.`,
		category: 'Water & Wellness',
		status: 'published',
		publishedAt: new Date('2026-05-08T09:00:00.000Z'),
		featuredAt: new Date('2026-05-08T09:00:00.000Z'),
	},
	{
		title: 'What Good Water Brings to Tea and Coffee',
		slug: 'what-good-water-brings-to-tea-and-coffee',
		excerpt:
			'Water makes up most of every cup. Improving it can reveal sweetness, clarity, and balance that were already waiting in the beans or leaves.',
		content: `We spend time choosing coffee beans and tea leaves, then often overlook the ingredient that fills almost the entire cup.

Water carries flavour from coffee and tea into the drink. If it has a strong odour, excessive hardness, or an unbalanced mineral profile, delicate notes can become muted or harsh.

Filtered water creates a cleaner starting point. It allows floral teas to feel more open, dark roasts to taste less blunt, and lighter coffees to show their natural acidity without becoming sharp.

Temperature matters too. Tea varieties respond to different levels of heat, while coffee benefits from water that is hot enough to extract flavour without scorching it. Reliable access to hot water makes consistency easier.

The improvement is not about making every cup complicated. It is the opposite: when the water is right, fewer adjustments are needed and the character of the drink can speak for itself.`,
		category: 'Taste & Culture',
		status: 'published',
		publishedAt: new Date('2026-05-04T09:00:00.000Z'),
		featuredAt: new Date('2026-05-04T09:00:00.000Z'),
	},
	{
		title: 'How to Build a Calmer Morning Routine',
		slug: 'how-to-build-a-calmer-morning-routine',
		excerpt:
			'A calmer morning is less about waking earlier and more about removing decisions from the first hour of the day.',
		content: `The tone of a morning is often set by friction: searching for what you need, making too many choices, or beginning the day already behind.

Prepare the environment the evening before. Clear the kitchen surface, set out one or two breakfast essentials, and make sure clean drinking water is ready. These actions create a visible invitation to begin slowly.

Keep the first sequence simple. Water, light, movement, and nourishment are reliable foundations. They support the body before notifications and decisions begin competing for attention.

Avoid designing an ideal routine that only works on quiet days. A useful routine should survive a late start, a busy household, and an unexpected change of plan.

Calm is not always silence or perfect order. Often it is simply the confidence that the essentials are available and the next step is clear.`,
		category: 'Everyday Rituals',
		status: 'published',
		publishedAt: new Date('2026-04-28T09:00:00.000Z'),
		featuredAt: new Date('2026-04-28T09:00:00.000Z'),
	},
	{
		title: 'The Real Cost of Relying on Bottled Water at Home',
		slug: 'the-real-cost-of-relying-on-bottled-water-at-home',
		excerpt:
			'The price on the bottle is only one part of the story. Storage, transport, waste, and interrupted supply all carry a cost.',
		content: `Bottled water can feel convenient because each purchase is familiar. Over time, however, the household cost extends beyond the amount paid at the shop.

There is the work of transport: carrying packs, arranging deliveries, and planning around supply. There is also the space required to store full bottles and the effort needed to manage empty ones.

Plastic waste is another visible consequence. Even where recycling exists, collection and processing are not always consistent, which means a daily necessity can create a steady stream of material with a very short useful life.

A home purification system changes the pattern from repeated purchasing to planned ownership. Filters and service still have a cost, but they are predictable and connected to a system designed for long-term use.

The right comparison is not one bottle against one glass. It is the total experience of supplying a household with water every day for years.`,
		category: 'Smart Living',
		status: 'published',
		publishedAt: new Date('2026-04-20T09:00:00.000Z'),
		featuredAt: new Date('2026-04-20T09:00:00.000Z'),
	},
	{
		title: 'Hosting Well Starts Before Your Guests Arrive',
		slug: 'hosting-well-starts-before-your-guests-arrive',
		excerpt:
			'Thoughtful hosting is not performance. It is the quiet preparation that lets everyone, including the host, feel at ease.',
		content: `The most memorable homes are not always the most formal. They are the ones where guests understand instinctively that they can settle in.

Prepare drinks before attention is divided. Chilled water, clean glasses, and a simple option such as citrus or herbs create an easy welcome without requiring constant service.

Let the room do some of the work. Clear a place for personal items, soften the lighting, and keep the path between seating, food, and water unobstructed.

Choose a menu that allows you to remain present. One dependable main dish and a few well-made accompaniments often feel more generous than an elaborate meal that keeps the host away from the table.

Good hosting is a form of care expressed through preparation. When the essentials are handled in advance, conversation has room to become the centre of the evening.`,
		category: 'Home & Hospitality',
		status: 'published',
		publishedAt: new Date('2026-04-12T09:00:00.000Z'),
		featuredAt: new Date('2026-04-12T09:00:00.000Z'),
	},
	{
		title: 'When Should You Replace a Water Filter?',
		slug: 'when-should-you-replace-a-water-filter',
		excerpt:
			'Time is a useful guide, but water quality, household usage, and changes in performance also tell you when a filter needs attention.',
		content: `Filter replacement intervals are designed to make maintenance predictable, but they are not the only signal worth noticing.

A change in taste or odour can indicate that a filter is approaching the end of its effective life. Reduced flow may also suggest that sediment has accumulated, particularly where the incoming water carries more particles.

Household demand matters. A system serving a busy family processes more water than one used by a single person, so usage can bring replacement forward even when the calendar date has not arrived.

Do not wait for a dramatic change. Regular service protects water quality and reduces strain on the system. Keeping a simple maintenance record makes it easier to plan replacements before they become urgent.

If you are uncertain, speak with the service team and share what you have observed. Good maintenance advice considers the system, the water source, and the way your household actually uses water.`,
		category: 'Care & Maintenance',
		status: 'published',
		publishedAt: new Date('2026-04-04T09:00:00.000Z'),
		featuredAt: new Date('2026-04-04T09:00:00.000Z'),
	},
];

export async function seedBlogs(dataSource: DataSource) {
	const blogs = dataSource.getRepository(BlogEntity);
	const users = dataSource.getRepository(UserEntity);
	const products = dataSource.getRepository(ProductEntity);
	const author = await users.findOne({ where: { role: Role.WRITER } });

	if (!author) {
		throw new Error('Writer user must be seeded before blogs');
	}

	const relatedProducts = await products.find({
		where: { status: 'active' },
		order: { sortOrder: 'ASC', createdAt: 'DESC' },
		take: 3,
	});

	for (const seed of blogSeeds) {
		const existing = await blogs.findOne({
			where: { slug: seed.slug },
			relations: ['relatedProducts'],
		});
		const readTimeMinutes = calculateReadTime(seed.content);
		const values = {
			...seed,
			author,
			authorId: author.id,
			readTimeMinutes,
			relatedProducts,
		};

		await blogs.save(existing ? blogs.merge(existing, values) : blogs.create(values));
	}
}

function calculateReadTime(content: string) {
	const words = content.trim().split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.ceil(words / 220));
}
