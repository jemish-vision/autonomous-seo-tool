import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler"; // cheerio's own signatures take its node types from here
import type {
  StructuredDataCounts,
  StructuredDataError,
  StructuredDataFormat,
  StructuredDataItem,
  StructuredDataRecord,
  StructuredDataReport,
  StructuredDataValidation,
} from "../models/types";
import { collapseWhitespace, resolveAbsolute } from "./shared";

export function extractStructuredData($: CheerioAPI): StructuredDataRecord[] {
  const out: StructuredDataRecord[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = ($(el).html() ?? "").trim(); // outer-trim only — internal JSON whitespace must stay byte-faithful
    let parsed: unknown = null;
    let parseError: string | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
    out.push({ type: "application/ld+json", raw, parsed, parseError });
  });
  return out;
}

/** A property group: satisfied when ANY member is present (Google's "price or priceSpecification"). */
type PropSpec = string | string[];

interface Profile {
  required: PropSpec[];
  recommended: PropSpec[];
}

/**
 * Google's rich-result requirements, NOT schema.org's. schema.org marks almost nothing as required,
 * so validating against it finds nothing; these lists mirror the "Required/Recommended properties"
 * tables in Google's Search Central structured-data docs.
 */
const PROFILES: Record<string, Profile> = {
  Product: {
    required: ["name", ["offers", "review", "aggregateRating"]],
    recommended: ["image", "description", "brand", ["sku", "gtin", "gtin8", "gtin12", "gtin13", "gtin14", "mpn"], "offers", "aggregateRating"],
  },
  /** Variants carry their own offers, so a ProductGroup must not be gated on top-level offers. */
  ProductGroup: {
    required: ["name", "hasVariant"],
    recommended: ["productGroupID", "variesBy", "image", "description", "brand"],
  },
  Offer: {
    required: [["price", "priceSpecification"], "priceCurrency"],
    recommended: ["availability", "url", "priceValidUntil", "itemCondition", "shippingDetails"],
  },
  AggregateOffer: {
    required: ["lowPrice", "priceCurrency"],
    recommended: ["highPrice", "offerCount"],
  },
  Article: {
    required: ["headline"],
    recommended: ["image", "datePublished", "dateModified", "author", "publisher"],
  },
  FAQPage: { required: ["mainEntity"], recommended: [] },
  QAPage: { required: ["mainEntity"], recommended: [] },
  Question: { required: ["name", ["acceptedAnswer", "suggestedAnswer"]], recommended: [] },
  Answer: { required: ["text"], recommended: ["url"] },
  BreadcrumbList: { required: ["itemListElement"], recommended: [] },
  ListItem: { required: ["position", "name"], recommended: ["item"] },
  ItemList: { required: ["itemListElement"], recommended: ["numberOfItems", "itemListOrder"] },
  Organization: {
    required: ["name", "url"],
    recommended: ["logo", "sameAs", "description", ["address", "contactPoint", "telephone"]],
  },
  LocalBusiness: {
    required: ["name", "address"],
    recommended: ["telephone", "url", "image", "priceRange", ["openingHoursSpecification", "openingHours"], "geo"],
  },
  PostalAddress: {
    required: ["streetAddress", "addressLocality", "addressCountry"],
    recommended: ["postalCode", "addressRegion"],
  },
  ContactPoint: { required: ["telephone", "contactType"], recommended: ["areaServed", "availableLanguage"] },
  OpeningHoursSpecification: { required: ["dayOfWeek"], recommended: ["opens", "closes"] },
  Recipe: {
    required: ["name", "image"],
    recommended: ["author", "datePublished", "description", "recipeIngredient", "recipeInstructions", "recipeYield", ["totalTime", "cookTime"], "nutrition", "aggregateRating", "video"],
  },
  Event: {
    required: ["name", "startDate", "location"],
    recommended: ["description", "endDate", "image", "offers", "performer", "organizer", "eventStatus", "eventAttendanceMode"],
  },
  Place: { required: ["address"], recommended: ["name", "geo"] },
  VirtualLocation: { required: ["url"], recommended: [] },
  Review: {
    required: ["author", "reviewRating"],
    recommended: ["datePublished", "reviewBody", "itemReviewed", "publisher"],
  },
  Rating: { required: ["ratingValue"], recommended: ["bestRating", "worstRating"] },
  AggregateRating: {
    required: ["ratingValue", ["ratingCount", "reviewCount"]],
    recommended: ["bestRating", "worstRating", "itemReviewed"],
  },
  VideoObject: {
    required: ["name", "description", "thumbnailUrl", "uploadDate"],
    recommended: ["duration", ["contentUrl", "embedUrl"], "publisher", "interactionStatistic", "expires"],
  },
  ImageObject: {
    required: [["contentUrl", "url"]],
    recommended: ["license", "acquireLicensePage", "creator", "creditText", "copyrightNotice"],
  },
  JobPosting: {
    required: ["title", "description", "datePosted", "hiringOrganization", ["jobLocation", "jobLocationType", "applicantLocationRequirements"]],
    recommended: ["baseSalary", "employmentType", "validThrough", "identifier", "directApply"],
  },
  MonetaryAmount: { required: ["currency", "value"], recommended: [] },
  HowTo: {
    required: ["name", "step"],
    recommended: ["image", "totalTime", "estimatedCost", "supply", "tool", "video"],
  },
  HowToStep: { required: [["text", "itemListElement"]], recommended: ["name", "url", "image"] },
  Course: {
    required: ["name", "description", "provider"],
    recommended: ["offers", "hasCourseInstance", "aggregateRating", "image", "url"],
  },
  SoftwareApplication: {
    required: ["name", "offers", ["aggregateRating", "review"]],
    recommended: ["applicationCategory", "operatingSystem"],
  },
  Book: { required: ["name", "author"], recommended: ["isbn", "url", "workExample", "sameAs", "bookEdition"] },
  Movie: { required: ["name"], recommended: ["image", "dateCreated", "director", "aggregateRating", "review"] },
  Person: { required: ["name"], recommended: ["url", "image", "jobTitle", "sameAs"] },
  Brand: { required: ["name"], recommended: [] },
  WebSite: { required: ["name", "url"], recommended: ["potentialAction"] },
  SearchAction: { required: ["target", "query-input"], recommended: [] },
  Dataset: { required: ["name", "description"], recommended: ["license", "creator", "url", "distribution", "identifier"] },
  ProfilePage: { required: ["mainEntity"], recommended: ["dateCreated", "dateModified"] },
};

/** Subtypes inherit their parent's Google requirements — NewsArticle is validated as Article. */
const ALIAS_GROUPS: Record<string, string> = {
  Article: `NewsArticle BlogPosting TechArticle ScholarlyArticle MedicalScholarlyArticle Report SatiricalArticle
    AdvertiserContentArticle LiveBlogPosting OpinionNewsArticle ReviewNewsArticle AnalysisNewsArticle
    BackgroundNewsArticle ReportageNewsArticle AskPublicNewsArticle`,
  Product: `IndividualProduct ProductModel Vehicle Car Motorcycle BusOrCoach`,
  Organization: `Corporation NGO EducationalOrganization GovernmentOrganization PerformingGroup SportsOrganization
    SportsTeam MusicGroup TheaterGroup DanceGroup NewsMediaOrganization Airline Consortium FundingScheme
    MedicalOrganization LibrarySystem CollegeOrUniversity School Project ResearchProject OnlineBusiness`,
  LocalBusiness: `Store Restaurant FoodEstablishment CafeOrCoffeeShop Bakery BarOrPub Brewery Winery Distillery
    FastFoodRestaurant IceCreamShop LodgingBusiness Hotel BedAndBreakfast Motel Resort Campground Hostel
    ProfessionalService LegalService Attorney Notary AccountingService FinancialService BankOrCreditUnion
    InsuranceAgency RealEstateAgent TravelAgency EmploymentAgency AutomotiveBusiness AutoRepair AutoDealer
    AutoBodyShop AutoPartsStore AutoRental AutoWash GasStation MotorcycleDealer MotorcycleRepair
    HomeAndConstructionBusiness Electrician Plumber HVACBusiness RoofingContractor GeneralContractor
    HousePainter Locksmith MovingCompany HealthAndBeautyBusiness BeautySalon HairSalon DaySpa
    NailSalon TattooParlor HealthClub ExerciseGym SportsActivityLocation GolfCourse SkiResort SwimmingPool
    TennisComplex BowlingAlley MedicalBusiness Dentist Physician Optician Pharmacy VeterinaryCare MedicalClinic
    DentistOffice EmergencyService FireStation PoliceStation Hospital ChildCare Preschool DryCleaningOrLaundry
    EntertainmentBusiness MovieTheater NightClub AmusementPark ArtGallery Casino ComedyClub
    RecyclingCenter SelfStorage ShoppingCenter TouristInformationCenter GovernmentOffice PostOffice Library
    InternetCafe ClothingStore GroceryStore HardwareStore JewelryStore BookStore ElectronicsStore FurnitureStore
    PetStore ToyStore ShoeStore SportingGoodsStore DepartmentStore ConvenienceStore LiquorStore MobilePhoneStore
    MusicStore OfficeEquipmentStore OutletStore GardenStore FloristShop HobbyShop ComputerStore TireShop
    WholesaleStore PawnShop`,
  Event: `BusinessEvent ChildrensEvent ComedyEvent CourseInstance DanceEvent DeliveryEvent EducationEvent
    ExhibitionEvent Festival FoodEvent Hackathon LiteraryEvent MusicEvent PublicationEvent SaleEvent
    ScreeningEvent SocialEvent SportsEvent TheaterEvent VisualArtsEvent BroadcastEvent EventSeries`,
  Review: `ClaimReview CriticReview UserReview EmployerReview MediaReview Recommendation`,
  HowToStep: `HowToSection`,
  ImageObject: `Barcode ImageObjectSnapshot`,
  SoftwareApplication: `WebApplication MobileApplication VideoGame`,
  Person: `Patient`,
};

const TYPE_ALIASES: Record<string, string> = {};
for (const [target, list] of Object.entries(ALIAS_GROUPS)) {
  for (const name of list.split(/\s+/).filter(Boolean)) TYPE_ALIASES[name] = target;
}

/**
 * schema.org types we recognize but deliberately don't gate — needed to tell an unvalidated real
 * type ("CollectionPage") from an invented or misspelled one ("Prodcut"), which are different findings.
 */
const UNGATED_KNOWN_TYPES = `Thing CreativeWork WebPage WebPageElement CollectionPage AboutPage ContactPage
  CheckoutPage ItemPage SearchResultsPage RealEstateListing MediaGallery ImageGallery VideoGallery Blog
  WPHeader WPFooter WPSideBar WPAdBlock SiteNavigationElement Comment Quotation Claim Table Atlas Chapter
  MediaObject AudioObject VideoGameClip Clip Episode TVEpisode TVSeries CreativeWorkSeries CreativeWorkSeason
  MusicAlbum MusicRecording MusicPlaylist MusicComposition PodcastEpisode PodcastSeries RadioEpisode
  Audiobook Newspaper Periodical PublicationIssue PublicationVolume Painting Sculpture Photograph
  GeoCoordinates GeoShape GeoCircle Country State City AdministrativeArea Language DefinedTerm DefinedTermSet
  CategoryCode CategoryCodeSet Occupation EmployerAggregateRating MonetaryAmountDistribution InteractionCounter
  StructuredValue PropertyValue QuantitativeValue Duration Distance Energy Mass Enumeration
  PriceSpecification UnitPriceSpecification DeliveryChargeSpecification PaymentChargeSpecification
  CompoundPriceSpecification OfferShippingDetails ShippingDeliveryTime ShippingRateSettings DefinedRegion
  MerchantReturnPolicy MerchantReturnPolicySeasonalOverride Audience PeopleAudience BusinessAudience
  EducationalAudience NutritionInformation RestrictedDiet HowToSupply HowToTool HowToItem HowToTip
  HowToDirection MenuItem Menu MenuSection Service GovernmentService FinancialProduct LoanOrCredit
  BankAccount InvestmentOrDeposit PaymentMethod CreditCard Trip TouristTrip TouristAttraction
  TouristDestination Accommodation Apartment House SingleFamilyResidence Residence Room HotelRoom Suite
  Reservation FlightReservation LodgingReservation Flight BusTrip TrainTrip WatchAction ViewAction ReadAction
  ListenAction ConsumeAction InteractAction EntryPoint Action OrderAction BuyAction
  CivicStructure Museum Park Beach Airport TrainStation BusStation SubwayStation Church PlaceOfWorship Zoo
  Aquarium Bridge Cemetery EventVenue MusicVenue StadiumOrArena PerformingArtsTheater Playground PublicToilet
  RVPark Landform Mountain Volcano BodyOfWater LandmarksOrHistoricalBuildings Continent
  MedicalCondition MedicalWebPage MedicalEntity AnatomicalStructure Diet ExercisePlan SpecialAnnouncement
  EducationalOccupationalCredential EducationalOccupationalProgram CourseInstance DataCatalog DataDownload
  SoftwareSourceCode ComputerLanguage APIReference Code Grant MonetaryGrant Role OrganizationRole
  ProgramMembership OwnershipInfo Demand TypeAndQuantityNode WarrantyPromise BusinessFunction
  ItemAvailability OfferItemCondition DayOfWeek GeospatialGeometry Drug DietarySupplement
  PropertyValueSpecification SpeakableSpecification SizeSpecification DeliveryTimeSettings
  PostalCodeRangeSpecification ArchiveComponent Certification WebContent Guide AmpStory
  ItemListOrderType MerchantReturnEnumeration ReturnFeesEnumeration PhysicalActivityCategory`
  .split(/\s+/)
  .filter(Boolean);

const KNOWN_TYPES = new Set<string>([
  ...Object.keys(PROFILES),
  ...Object.keys(TYPE_ALIASES),
  ...UNGATED_KNOWN_TYPES,
]);

/** Per-page caps — a pathological @graph must never blow up a page record. */
const MAX_ITEMS = 200;
const MAX_DEPTH = 12;

/** An extracted node before Google-requirement validation is attached. */
export type PendingStructuredDataItem = Omit<StructuredDataItem, "validation">;
type PendingItem = PendingStructuredDataItem;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isSchemaOrgUri(uri: string): boolean {
  return /^https?:\/\/(?:www\.)?schema\.org\/?/i.test(uri.trim());
}

/** "https://schema.org/Product" and "schema:Product" both reduce to "Product". */
function shortType(raw: string): string {
  const t = raw.trim();
  const url = /^https?:\/\/(?:www\.)?schema\.org\/(.+)$/i.exec(t);
  if (url) return url[1]!.replace(/^\/+/, "");
  const colon = t.indexOf(":");
  if (colon > 0 && !/^https?:/i.test(t)) return t.slice(colon + 1);
  return t;
}

function typeNamesOf(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list
    .filter((t): t is string => typeof t === "string")
    .map(shortType)
    .filter((t) => t.length > 0);
}

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function missingProps(specs: PropSpec[], node: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const spec of specs) {
    const names = Array.isArray(spec) ? spec : [spec];
    if (names.some((name) => hasValue(node[name]))) continue;
    out.push(names.join(" or "));
  }
  return out;
}

/** `{"@type":"Organization","@id":"#org"}` inside an @graph points at a node defined elsewhere. */
function isReferenceStub(node: Record<string, unknown>): boolean {
  if (!hasValue(node["@id"])) return false;
  return Object.keys(node).every((k) => k === "@id" || k === "@type" || k === "@context");
}

export function validateSchemaNode(types: string[], node: Record<string, unknown>): StructuredDataValidation {
  const empty = { missingRequired: [] as string[], missingRecommended: [] as string[] };
  if (types.length === 0) return { profile: null, status: "missing-type", ...empty };
  if (isReferenceStub(node)) return { profile: null, status: "reference", ...empty };
  for (const type of types) {
    const name = TYPE_ALIASES[type] ?? type;
    const profile = PROFILES[name];
    if (!profile) continue;
    return {
      profile: name,
      status: "validated",
      missingRequired: missingProps(profile.required, node),
      missingRecommended: missingProps(profile.recommended, node),
    };
  }
  if (types.some((t) => KNOWN_TYPES.has(t))) return { profile: null, status: "no-profile", ...empty };
  return { profile: null, status: "unknown-type", ...empty };
}

function addProp(node: Record<string, unknown>, name: string, value: unknown): void {
  const existing = node[name];
  if (existing === undefined) {
    node[name] = value;
    return;
  }
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  node[name] = [existing, value];
}

function tagNameOf(el: AnyNode): string {
  return ((el as { tagName?: string }).tagName ?? "").toLowerCase();
}

// ---- JSON-LD -------------------------------------------------------------

function walkJsonLd(
  value: unknown,
  blockIndex: number,
  path: string,
  depth: number,
  out: PendingItem[],
  isRoot: boolean,
): void {
  if (out.length >= MAX_ITEMS || depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    value.forEach((child, i) => walkJsonLd(child, blockIndex, `${path}[${i}]`, depth + 1, out, isRoot));
    return;
  }
  if (!isPlainObject(value)) return;

  const types = typeNamesOf(value);
  // A bare `{"@context":…,"@graph":[…]}` wrapper carries no type by design — not a missing-type finding.
  const isGraphWrapper = value["@graph"] !== undefined && types.length === 0;
  if (types.length > 0 || (isRoot && !isGraphWrapper)) {
    out.push({ format: "json-ld", types, path, blockIndex, node: value });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "@context" || key === "@type" || key === "@id") continue;
    walkJsonLd(child, blockIndex, `${path}.${key}`, depth + 1, out, key === "@graph");
  }
}

export function collectJsonLdItems(blocks: StructuredDataRecord[]): PendingItem[] {
  const out: PendingItem[] = [];
  blocks.forEach((block, i) => {
    if (block.parseError !== null || block.parsed === null) return;
    walkJsonLd(block.parsed, i, "$", 0, out, true);
  });
  return out;
}

// ---- Microdata -----------------------------------------------------------

/** Per the HTML microdata spec, these elements take their value from an attribute, not their text. */
const MICRODATA_URL_ATTR: Record<string, string> = {
  audio: "src",
  embed: "src",
  iframe: "src",
  img: "src",
  source: "src",
  track: "src",
  video: "src",
  a: "href",
  area: "href",
  link: "href",
  object: "data",
};

function microdataValue($: CheerioAPI, el: AnyNode, base: string): string {
  const $el = $(el);
  const tag = tagNameOf(el);
  if (tag === "meta") return ($el.attr("content") ?? "").trim();
  const urlAttr = MICRODATA_URL_ATTR[tag];
  if (urlAttr !== undefined) {
    const raw = ($el.attr(urlAttr) ?? "").trim();
    if (raw === "") return "";
    return resolveAbsolute(raw, base) ?? raw;
  }
  if (tag === "data" || tag === "meter") {
    const v = $el.attr("value");
    return v !== undefined ? v.trim() : collapseWhitespace($el.text());
  }
  if (tag === "time") {
    const dt = $el.attr("datetime");
    return dt !== undefined ? dt.trim() : collapseWhitespace($el.text());
  }
  return collapseWhitespace($el.text());
}

interface MicrodataCtx {
  $: CheerioAPI;
  base: string;
  out: PendingItem[];
  visited: Set<AnyNode>;
  rootCount: { n: number };
}

function buildMicrodataItem(ctx: MicrodataCtx, el: AnyNode, path: string, depth: number): Record<string, unknown> {
  const { $ } = ctx;
  const node: Record<string, unknown> = {};
  ctx.visited.add(el);

  const types = ($(el).attr("itemtype") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map(shortType);
  if (types.length === 1) node["@type"] = types[0];
  else if (types.length > 1) node["@type"] = types;
  const itemid = $(el).attr("itemid");
  if (itemid !== undefined && itemid.trim() !== "") node["@id"] = itemid.trim();

  // Pushed before the subtree walk so parents list before their children; validation runs later.
  if (ctx.out.length < MAX_ITEMS) ctx.out.push({ format: "microdata", types, path, blockIndex: null, node });

  if (depth <= MAX_DEPTH) {
    for (const child of $(el).children().toArray()) walkMicrodata(ctx, child, node, path, depth);
    for (const refId of ($(el).attr("itemref") ?? "").split(/\s+/).filter(Boolean)) {
      const ref = $(`[id="${refId.replace(/"/g, '\\"')}"]`).first();
      const refEl = ref.get(0);
      if (refEl === undefined || ctx.visited.has(refEl)) continue;
      walkMicrodata(ctx, refEl, node, path, depth);
    }
  }
  return node;
}

function walkMicrodata(
  ctx: MicrodataCtx,
  el: AnyNode,
  node: Record<string, unknown>,
  itemPath: string,
  depth: number,
): void {
  const { $ } = ctx;
  const $el = $(el);
  const names = ($el.attr("itemprop") ?? "").split(/\s+/).filter(Boolean);

  if ($el.attr("itemscope") !== undefined) {
    if (ctx.visited.has(el)) return;
    // A nested itemscope with no itemprop is its own top-level item per spec, not a property value.
    const childPath = names.length > 0 ? `${itemPath}.${names[0]}` : `microdata[${ctx.rootCount.n++}]`;
    const childNode = buildMicrodataItem(ctx, el, childPath, depth + 1);
    for (const name of names) addProp(node, name, childNode);
    return; // the nested item owns its own subtree
  }

  if (names.length > 0) {
    const value = microdataValue(ctx.$, el, ctx.base);
    for (const name of names) addProp(node, name, value);
  }
  if (depth <= MAX_DEPTH) {
    for (const child of $el.children().toArray()) walkMicrodata(ctx, child, node, itemPath, depth);
  }
}

export function extractMicrodata($: CheerioAPI, base: string): PendingItem[] {
  const ctx: MicrodataCtx = { $, base, out: [], visited: new Set(), rootCount: { n: 0 } };
  for (const el of $("[itemscope]").toArray()) {
    if (ctx.visited.has(el)) continue;
    if ($(el).attr("itemprop") !== undefined && $(el).parents("[itemscope]").length > 0) continue;
    buildMicrodataItem(ctx, el, `microdata[${ctx.rootCount.n++}]`, 0);
  }
  return ctx.out;
}

// ---- RDFa ----------------------------------------------------------------

/**
 * `<meta property="og:title" content="…">` is the exact shape of an RDFa property, so a naive
 * `[property][content]` scan reports RDFa on nearly every page. These vocabularies are never schema.org.
 */
const SOCIAL_PREFIXES = new Set([
  "og", "fb", "twitter", "article", "book", "profile", "music", "video", "product", "al", "ia", "medium",
  "dc", "dcterms", "dcmitype", "foaf", "rdf", "rdfs", "owl", "sioc", "skos", "xsd", "cc", "gr", "v", "vcard",
  "rev", "rel", "xhv", "wdrs", "grddl", "ctag", "earl", "sd", "void", "org", "time", "ma", "prov", "qb",
]);

function collectPrefixes($: CheerioAPI, el: AnyNode): Record<string, string> {
  const map: Record<string, string> = { schema: "https://schema.org/" };
  const chain = [...$(el).parents().toArray().reverse(), el];
  for (const node of chain) {
    const attr = $(node).attr("prefix");
    if (attr === undefined) continue;
    const tokens = attr.trim().split(/\s+/);
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const key = (tokens[i] ?? "").replace(/:$/, "").toLowerCase();
      const uri = tokens[i + 1] ?? "";
      if (key !== "" && uri !== "") map[key] = uri;
    }
  }
  return map;
}

/** Resolves an RDFa term to a bare schema.org name, or null when it belongs to another vocabulary. */
function resolveRdfaTerm(
  token: string,
  vocab: string | null,
  prefixes: Record<string, string>,
  allowBare: boolean,
): string | null {
  const t = token.trim();
  if (t === "") return null;
  if (/^https?:\/\//i.test(t)) {
    const m = /^https?:\/\/(?:www\.)?schema\.org\/(.+)$/i.exec(t);
    return m ? m[1]!.replace(/^\/+/, "") : null;
  }
  const colon = t.indexOf(":");
  if (colon > 0) {
    const pfx = t.slice(0, colon).toLowerCase();
    if (SOCIAL_PREFIXES.has(pfx)) return null;
    const uri = prefixes[pfx];
    return uri !== undefined && isSchemaOrgUri(uri) ? t.slice(colon + 1) : null;
  }
  if (colon === 0) return null;
  if (vocab !== null) return isSchemaOrgUri(vocab) ? t : null;
  return allowBare ? t : null;
}

function rdfaValue($: CheerioAPI, el: AnyNode, base: string): string {
  const $el = $(el);
  const content = $el.attr("content");
  if (content !== undefined) return content.trim();
  if (tagNameOf(el) === "time") {
    const dt = $el.attr("datetime");
    if (dt !== undefined) return dt.trim();
  }
  for (const attr of ["resource", "href", "src", "data"]) {
    const raw = $el.attr(attr);
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    return resolveAbsolute(trimmed, base) ?? trimmed;
  }
  return collapseWhitespace($el.text());
}

interface RdfaCtx {
  $: CheerioAPI;
  base: string;
  out: PendingItem[];
  rootCount: { n: number };
  /** typeof elements already built, so the root sweep doesn't emit a nested item twice. */
  handled: Set<AnyNode>;
}

function buildRdfaItem(
  ctx: RdfaCtx,
  el: AnyNode,
  types: string[],
  vocab: string | null,
  prefixes: Record<string, string>,
  path: string,
  depth: number,
): Record<string, unknown> {
  const { $ } = ctx;
  const node: Record<string, unknown> = {};
  ctx.handled.add(el);
  if (types.length === 1) node["@type"] = types[0];
  else if (types.length > 1) node["@type"] = types;
  const resource = $(el).attr("resource") ?? $(el).attr("about");
  if (resource !== undefined && resource.trim() !== "") node["@id"] = resource.trim();

  if (ctx.out.length < MAX_ITEMS) ctx.out.push({ format: "rdfa", types, path, blockIndex: null, node });
  if (depth <= MAX_DEPTH) {
    for (const child of $(el).children().toArray()) walkRdfa(ctx, child, node, vocab, prefixes, path, depth);
  }
  return node;
}

function walkRdfa(
  ctx: RdfaCtx,
  el: AnyNode,
  node: Record<string, unknown>,
  vocab: string | null,
  prefixes: Record<string, string>,
  itemPath: string,
  depth: number,
): void {
  const { $ } = ctx;
  const $el = $(el);
  const childVocab = $el.attr("vocab") ?? vocab;
  const childPrefixes = $el.attr("prefix") !== undefined ? collectPrefixes($, el) : prefixes;
  const propNames = ($el.attr("property") ?? "")
    .split(/\s+/)
    .map((t) => resolveRdfaTerm(t, childVocab, childPrefixes, true))
    .filter((t): t is string => t !== null);

  const typeofAttr = $el.attr("typeof");
  if (typeofAttr !== undefined) {
    const types = resolveRdfaTypes(typeofAttr, childVocab, childPrefixes);
    // Another vocabulary's node: stop here so its properties don't leak upward. Any schema.org
    // item nested deeper is still reached — the root sweep picks it up as an unhandled typeof.
    if (types.length === 0) return;
    const childPath = propNames.length > 0 ? `${itemPath}.${propNames[0]}` : `rdfa[${ctx.rootCount.n++}]`;
    const childNode = buildRdfaItem(ctx, el, types, childVocab, childPrefixes, childPath, depth + 1);
    for (const name of propNames) addProp(node, name, childNode);
    return;
  }

  if (propNames.length > 0) {
    const value = rdfaValue($, el, ctx.base);
    for (const name of propNames) addProp(node, name, value);
  }
  if (depth <= MAX_DEPTH) {
    for (const child of $el.children().toArray()) walkRdfa(ctx, child, node, childVocab, childPrefixes, itemPath, depth);
  }
}

function resolveRdfaTypes(typeofAttr: string, vocab: string | null, prefixes: Record<string, string>): string[] {
  const tokens = typeofAttr.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const token of tokens) {
    // With no vocab declared a bare type is only trusted when it really is a schema.org name —
    // otherwise `typeof="menu"` style markup would be reported as schema.org data.
    const resolved = resolveRdfaTerm(token, vocab, prefixes, false) ?? bareKnownType(token, vocab);
    if (resolved !== null && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

function bareKnownType(token: string, vocab: string | null): string | null {
  if (vocab !== null || token.includes(":") || token.includes("/")) return null;
  return KNOWN_TYPES.has(token) ? token : null;
}

export function extractRdfa($: CheerioAPI, base: string): PendingItem[] {
  const ctx: RdfaCtx = { $, base, out: [], rootCount: { n: 0 }, handled: new Set() };
  for (const el of $("[typeof]").toArray()) {
    if (ctx.handled.has(el)) continue;
    const vocab = $(el).closest("[vocab]").attr("vocab") ?? null;
    const prefixes = collectPrefixes($, el);
    const types = resolveRdfaTypes($(el).attr("typeof") ?? "", vocab, prefixes);
    if (types.length === 0) continue;
    buildRdfaItem(ctx, el, types, vocab, prefixes, `rdfa[${ctx.rootCount.n++}]`, 0);
  }
  return ctx.out;
}

// ---- Report --------------------------------------------------------------

function contextErrors(blocks: StructuredDataRecord[]): StructuredDataError[] {
  const errors: StructuredDataError[] = [];
  blocks.forEach((block, i) => {
    if (block.parseError !== null) {
      errors.push({
        kind: block.raw.trim() === "" ? "empty-block" : "malformed-json",
        format: "json-ld",
        blockIndex: i,
        message: block.raw.trim() === "" ? "Empty JSON-LD block." : `Invalid JSON-LD: ${block.parseError}`,
        value: null,
      });
      return;
    }
    const roots = Array.isArray(block.parsed) ? block.parsed : [block.parsed];
    for (const root of roots) {
      if (!isPlainObject(root)) continue;
      const ctx = root["@context"];
      if (ctx === undefined) {
        errors.push({
          kind: "missing-context",
          format: "json-ld",
          blockIndex: i,
          message: "JSON-LD block has no @context — Google requires https://schema.org.",
          value: null,
        });
      } else if (!/schema\.org/i.test(JSON.stringify(ctx))) {
        errors.push({
          kind: "invalid-context",
          format: "json-ld",
          blockIndex: i,
          message: "JSON-LD @context does not reference schema.org.",
          value: JSON.stringify(ctx).slice(0, 200),
        });
      }
    }
  });
  return errors;
}

/**
 * All three structured-data syntaxes plus Google rich-result validation.
 * `blocks` is accepted so a caller that already ran extractStructuredData doesn't parse twice.
 */
export function buildStructuredDataReport(
  $: CheerioAPI,
  base: string,
  blocks?: StructuredDataRecord[],
): StructuredDataReport {
  const jsonLdBlocks = blocks ?? extractStructuredData($);
  const pending = [
    ...collectJsonLdItems(jsonLdBlocks),
    ...extractMicrodata($, base),
    ...extractRdfa($, base),
  ];
  // Each collector stops pushing at the cap, so "reached the cap" is the strongest claim available.
  const truncated = pending.length >= MAX_ITEMS;
  const items: StructuredDataItem[] = pending
    .slice(0, MAX_ITEMS)
    .map((item) => ({ ...item, validation: validateSchemaNode(item.types, item.node) }));

  const errors = contextErrors(jsonLdBlocks);
  for (const item of items) {
    if (item.validation.status === "unknown-type") {
      errors.push({
        kind: "unknown-type",
        format: item.format,
        blockIndex: item.blockIndex,
        message: `"${item.types.join(", ")}" is not a schema.org type.`,
        value: item.types.join(", "),
      });
    } else if (item.validation.status === "missing-type") {
      errors.push({
        kind: "missing-type",
        format: item.format,
        blockIndex: item.blockIndex,
        message: "Structured-data node declares no @type.",
        value: null,
      });
    }
  }

  const counts: StructuredDataCounts = {
    jsonLdBlocks: jsonLdBlocks.length,
    jsonLdParseErrors: jsonLdBlocks.filter((b) => b.parseError !== null).length,
    items: items.length,
    jsonLdItems: countFormat(items, "json-ld"),
    microdataItems: countFormat(items, "microdata"),
    rdfaItems: countFormat(items, "rdfa"),
    validatedItems: items.filter((i) => i.validation.status === "validated").length,
    itemsMissingRequired: items.filter((i) => i.validation.missingRequired.length > 0).length,
    unknownTypes: items.filter((i) => i.validation.status === "unknown-type").length,
  };

  const types = [...new Set(items.flatMap((i) => i.types))].sort();
  return { items, counts, errors, types, truncated };
}

function countFormat(items: StructuredDataItem[], format: StructuredDataFormat): number {
  return items.filter((i) => i.format === format).length;
}
