import HeroCarousel from '../../components/HeroCarousel/HeroCarousel';

/* Photos for the Clubs page header (shared HeroCarousel: right side, black fade from the left) */
const SLIDES = [
  { src: '/f9.png',               caption: 'Art Club — Drawing Session' },
  { src: '/f6.png',               caption: "Girls' Volleyball Match" },
  { src: '/f3.png',               caption: 'Chess — a focused move at the board' },
  { src: '/f4.png',               caption: 'Carrom Match — Inter-Department Games' },
  { src: '/images/img8.png',      caption: 'Cricket League on the RKU ground' },
  { src: '/images/i14.png',       caption: 'Inter-Department Football' },
  { src: '/g2.png',               caption: 'Students cheering on campus' },
  { src: '/f7.png',               caption: 'Volleyball — Leaping for the Ball' },
  { src: '/k.png',                caption: "Girls' Volleyball Team" },
  { src: '/images/i22.png',       caption: 'Rangoli Art — Colored Powder Work' },
  { src: '/f2.png',               caption: 'Table Tennis Doubles' },
  { src: '/images/asset-35.jpeg', caption: "Chess — Sports Fiesta '25" },
];

export default function ClubsCarousel() {
  return <HeroCarousel slides={SLIDES} />;
}
