import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { BlogEntity } from '../../blogs/entities/blog.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { Role } from '../../common/enums/role.enum';

type BlogSeed = {
	title: string;
	slug: string;
	excerpt: string;
	content: string;
	category: string;
	publishedAt: Date;
	featuredAt: Date | null;
};

const blogSeeds: BlogSeed[] = [
	{
		title: 'How to Plan an Event Guests Actually Talk About',
		slug: 'how-to-plan-an-event-guests-actually-talk-about',
		excerpt: 'Memorable events are built before the first guest arrives. Here is how organizers can turn logistics into atmosphere.',
		category: 'Event Planning',
		publishedAt: new Date('2026-07-20T09:00:00.000Z'),
		featuredAt: new Date('2026-07-20T09:00:00.000Z'),
		content: `A great event rarely feels complicated to the people attending it. That ease is usually the result of careful planning, clear decisions, and a team that understands what the night is meant to feel like.

Start with one sharp promise. Is the event about discovery, celebration, networking, music, faith, food, or community? Once the promise is clear, every decision has a useful filter.

The venue should support the rhythm of the event. Think through arrival, check-in, queue movement, restrooms, vendor placement, backstage access, and how people will leave at the end.

Guests remember transitions. The walk from entry to first drink, the wait before the headline act, the moment after a panel ends, and the final ten minutes all shape the story people tell later.

Ticketing is part of the experience too. Clear tiers, honest descriptions, fast checkout, and mobile-friendly confirmation reduce anxiety and build trust before the event begins.

The best event planning is not just a checklist. It is the art of removing friction so the audience can feel the reason they came.`,
	},
	{
		title: 'Choosing Vendors Without Guesswork',
		slug: 'choosing-vendors-without-guesswork',
		excerpt: 'The right vendor can lift an event. The wrong one can quietly damage the whole guest experience.',
		category: 'Vendors',
		publishedAt: new Date('2026-07-16T09:00:00.000Z'),
		featuredAt: new Date('2026-07-16T09:00:00.000Z'),
		content: `Vendors are not just suppliers. They are part of the event your guests will experience directly.

Before comparing prices, define the job clearly. A caterer needs guest count, service style, timing, location, access, and dietary expectations. A DJ needs audience profile, program flow, sound restrictions, and the moments that matter most.

Look for proof of reliability. Photos are useful, but reviews, past event types, response time, and operational questions reveal more than a polished gallery.

Ask how the vendor handles pressure. What happens if the weather changes, a delivery is delayed, power fails, or the crowd is larger than expected? Calm answers matter.

For organizers, a strong vendor directory shortens the search and makes comparison easier. For vendors, complete profiles, clear categories, and current catalogues make trust visible.

The goal is not to choose the most expensive vendor. It is to choose the one whose preparation matches the promise of your event.`,
	},
	{
		title: 'Why Influencer Campaigns Work Best Before Tickets Slow Down',
		slug: 'why-influencer-campaigns-work-best-before-tickets-slow-down',
		excerpt: 'Influencer marketing works better as momentum, not rescue. Invite creators early and give them something worth sharing.',
		category: 'Influencer Marketing',
		publishedAt: new Date('2026-07-11T09:00:00.000Z'),
		featuredAt: new Date('2026-07-11T09:00:00.000Z'),
		content: `Influencer campaigns are often treated like emergency promotion. Sales slow down, pressure rises, and organizers start asking creators to push harder. That is usually too late.

Creators perform best when they have time to understand the event and make the invitation feel natural to their audience. Early campaigns create awareness, social proof, and repeated exposure before urgency arrives.

Give each influencer a clear offer. A coupon code, tracked sales, campaign brief, approved assets, and payout rules remove confusion and make collaboration easier.

The best creators do not only post. They translate the event into language their community already understands. That is why niche fit matters as much as follower count.

Refund windows and payout timing should also be clear. If buyers can request refunds before an event, influencer earnings should become withdrawable after the refund-risk period has passed.

Promotion is strongest when it feels like participation. Bring creators in early enough to help the event gather energy.`,
	},
	{
		title: 'Ticket Tiers That Make Buyers Decide Faster',
		slug: 'ticket-tiers-that-make-buyers-decide-faster',
		excerpt: 'Good ticket tiers are easy to understand, easy to compare, and honest about what each guest receives.',
		category: 'Ticketing',
		publishedAt: new Date('2026-07-07T09:00:00.000Z'),
		featuredAt: null,
		content: `Ticket tiers can help sales, but only when buyers understand the difference quickly.

Start with names people already recognize. Regular, VIP, Table for 5, Early Bird, Backstage, and Group Access are clearer than creative labels that need explanation.

Every tier should answer three questions: what do I get, how many people does it cover, and why is it worth this price? If the answer is vague, buyers hesitate.

Limit the number of options. Too many tiers make the buyer compare instead of commit. A simple structure often converts better than a long menu.

Use scarcity carefully. Quantity limits, date-based pricing, and early bird windows work when they are real. Fake urgency damages trust.

Good ticketing is not just payment collection. It is decision design. The easier the choice feels, the faster a guest moves from interest to purchase.`,
	},
	{
		title: 'What Attendees Need After Buying a Ticket',
		slug: 'what-attendees-need-after-buying-a-ticket',
		excerpt: 'The sale is not the end of the journey. Confirmation, reminders, and clear support reduce refunds and missed arrivals.',
		category: 'Attendee Experience',
		publishedAt: new Date('2026-07-02T09:00:00.000Z'),
		featuredAt: null,
		content: `After a guest buys a ticket, they need confidence.

The confirmation email should make the next step obvious. It should show the event name, date, venue, ticket type, quantity, buyer details, and a simple way to find the ticket again.

Guests also need reminders. A short message before the event can reduce missed arrivals and support requests. Include time, location, entry rules, parking notes, and anything guests should bring.

Refund information should be easy to find. When policies are hidden, buyers become anxious and support teams spend more time explaining.

For organizers, post-purchase clarity reduces pressure on event day. For attendees, it turns a transaction into a plan.

A smooth event starts long before check-in. It starts when the buyer feels sure that the ticket, the details, and the organizer are all reliable.`,
	},
	{
		title: 'How Vendors Can Build a Catalogue That Gets Booked',
		slug: 'how-vendors-can-build-a-catalogue-that-gets-booked',
		excerpt: 'A vendor catalogue should help organizers picture the service, compare options, and take action without needing a long back-and-forth.',
		category: 'Vendor Growth',
		publishedAt: new Date('2026-06-28T09:00:00.000Z'),
		featuredAt: null,
		content: `A vendor profile creates attention. A vendor catalogue creates decisions.

Each catalogue item should have a clear name, strong image, price or price range, minimum order quantity, unit measure, and a short description that explains the result.

Avoid vague descriptions. Instead of saying "premium catering," explain the menu style, serving format, number of guests covered, setup needs, and what is included.

Images matter because organizers are buying confidence. Use bright, real examples of your work. If the service is not visual, show the team, setup, equipment, or final event environment.

Keep prices current. Even when final quotes depend on the event, a starting range helps organizers know whether the vendor fits their budget.

The best catalogue reduces uncertainty. When an organizer understands what you do and how to book it, you become easier to choose.`,
	},
];

export async function seedBlogs(dataSource: DataSource) {
	const blogs = dataSource.getRepository(BlogEntity);
	const author = await ensureBlogAuthor(dataSource);

	for (const seed of blogSeeds) {
		const existing = await blogs.findOne({ where: { slug: seed.slug } });
		if (existing) {
			console.log(`Skipped existing blog: ${seed.slug}`);
			continue;
		}

		await blogs.save(
			blogs.create({
				...seed,
				status: 'published',
				author,
				authorId: author.id,
				readTimeMinutes: calculateReadTime(seed.content),
				relatedProducts: [],
			}),
		);
		console.log(`Created blog: ${seed.slug}`);
	}
}

async function ensureBlogAuthor(dataSource: DataSource) {
	const users = dataSource.getRepository(UserEntity);
	const email = 'editorial@venuespice.com';
	const existing = await users.findOne({ where: { email } });
	const now = new Date();

	if (existing) {
		if (existing.role !== Role.WRITER || !existing.verifiedAt || !existing.isActive) {
			existing.role = Role.WRITER;
			existing.isActive = true;
			existing.verifiedAt = existing.verifiedAt || now;
			existing.activeAt = existing.activeAt || now;
			await users.save(existing);
		}
		return existing;
	}

	return users.save(
		users.create({
			fullName: 'Venue Spice Editorial',
			email,
			passwordHash: await bcrypt.hash('password123*', 10),
			role: Role.WRITER,
			isActive: true,
			verifiedAt: now,
			activeAt: now,
		}),
	);
}

function calculateReadTime(content: string) {
	const words = content.trim().split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.ceil(words / 220));
}
