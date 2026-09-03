/**
 * The background art, as three inert drawings.
 *
 * Server components with no state and no props: they are wallpaper. Each is
 * `aria-hidden`, `pointer-events: none` through `.art` in `landing.css`, and
 * sits at `z-index: 0` beneath a content layer the stylesheet raises above it.
 * None of them can shift layout — every one is absolutely positioned inside a
 * section that establishes the containing block — and none can take a click.
 *
 * The path data is transcribed from `prototype/limen-landing.html` unchanged.
 * It is not generated here and should not be regenerated: the price tape is a
 * *particular* flat line with a step in it, and the histogram is a particular
 * set of bars. Redrawing them from a new random seed would change the picture
 * for no reason and lose the one property that matters, which is that both
 * read as a market that is mostly not doing anything.
 *
 * The tick labels are hours. They are decoration on a decorative axis, and they
 * are `aria-hidden` with the rest of it.
 */

/** The doorway, in the section about how a limit gets installed. A limen. */
export function SillArt() {
  return (
    <svg className="art art-sill" viewBox="0 0 620 900" aria-hidden="true" focusable="false">
      <rect x="40" y="150" width="86" height="750"/>
      <rect x="494" y="150" width="86" height="750"/>
      <rect x="40" y="150" width="540" height="86"/>
      <rect className="lip" x="0" y="236" width="620" height="10"/>
    </svg>
  );
}

/**
 * The flat price tape, behind the ledger proof.
 *
 * Flat on purpose, and it is the same fact `CandleTape` documents at length: a
 * testnet quote is a function of pool reserves and does not move on its own.
 * This one is drawn honestly rather than animated, because the section it sits
 * behind is the section about what actually happened on chain.
 */
export function PriceTapeArt() {
  return (
    <svg className="art art-price" viewBox="0 0 1200 148" aria-hidden="true" focusable="false">
      <path className="area" d="M 0 72.7 L 10 72.8 L 20 72.9 L 30 73.0 L 40 73.1 L 50 73.1 L 60 73.0 L 70 72.9 L 80 72.8 L 90 72.9 L 100 72.9 L 110 73.0 L 120 73.1 L 130 73.2 L 140 73.3 L 150 73.2 L 160 73.1 L 170 73.0 L 180 72.9 L 190 73.0 L 200 73.0 L 210 73.0 L 220 72.9 L 230 72.8 L 240 72.7 L 250 72.8 L 260 72.8 L 270 72.7 L 280 72.7 L 290 72.8 L 300 72.8 L 310 73.0 L 320 72.8 L 330 72.7 L 340 72.7 L 350 72.8 L 360 72.6 L 370 72.6 L 380 72.5 L 390 72.4 L 400 72.4 L 410 72.4 L 420 72.4 L 430 72.4 L 440 72.5 L 450 72.6 L 460 72.5 L 470 72.6 L 480 72.8 L 490 72.7 L 500 72.8 L 510 72.8 L 520 72.8 L 530 72.8 L 540 72.7 L 550 72.8 L 560 72.8 L 570 72.9 L 580 72.3 L 590 71.8 L 600 71.3 L 610 70.7 L 620 70.1 L 630 69.6 L 640 68.9 L 650 68.5 L 660 68.0 L 670 67.5 L 680 66.9 L 690 66.3 L 700 66.4 L 710 66.5 L 720 66.6 L 730 66.6 L 740 66.8 L 750 66.7 L 760 66.5 L 770 66.4 L 780 66.3 L 790 66.1 L 800 66.3 L 810 66.4 L 820 66.2 L 830 66.1 L 840 66.1 L 850 66.0 L 860 65.9 L 870 65.8 L 880 65.9 L 890 66.0 L 900 66.0 L 910 66.2 L 920 66.2 L 930 66.0 L 940 66.1 L 950 66.3 L 960 66.4 L 970 66.6 L 980 66.5 L 990 66.5 L 1000 66.6 L 1010 66.7 L 1020 66.6 L 1030 66.6 L 1040 66.7 L 1050 66.9 L 1060 67.0 L 1070 67.1 L 1080 67.1 L 1090 67.2 L 1100 67.4 L 1110 67.4 L 1120 67.5 L 1130 67.3 L 1140 67.4 L 1150 67.4 L 1160 67.3 L 1170 67.4 L 1180 67.2 L 1190 67.2 L 1200 67.3 L 1200 120 L 0 120 Z" />
      <path className="line" d="M 0 72.7 L 10 72.8 L 20 72.9 L 30 73.0 L 40 73.1 L 50 73.1 L 60 73.0 L 70 72.9 L 80 72.8 L 90 72.9 L 100 72.9 L 110 73.0 L 120 73.1 L 130 73.2 L 140 73.3 L 150 73.2 L 160 73.1 L 170 73.0 L 180 72.9 L 190 73.0 L 200 73.0 L 210 73.0 L 220 72.9 L 230 72.8 L 240 72.7 L 250 72.8 L 260 72.8 L 270 72.7 L 280 72.7 L 290 72.8 L 300 72.8 L 310 73.0 L 320 72.8 L 330 72.7 L 340 72.7 L 350 72.8 L 360 72.6 L 370 72.6 L 380 72.5 L 390 72.4 L 400 72.4 L 410 72.4 L 420 72.4 L 430 72.4 L 440 72.5 L 450 72.6 L 460 72.5 L 470 72.6 L 480 72.8 L 490 72.7 L 500 72.8 L 510 72.8 L 520 72.8 L 530 72.8 L 540 72.7 L 550 72.8 L 560 72.8 L 570 72.9 L 580 72.3 L 590 71.8 L 600 71.3 L 610 70.7 L 620 70.1 L 630 69.6 L 640 68.9 L 650 68.5 L 660 68.0 L 670 67.5 L 680 66.9 L 690 66.3 L 700 66.4 L 710 66.5 L 720 66.6 L 730 66.6 L 740 66.8 L 750 66.7 L 760 66.5 L 770 66.4 L 780 66.3 L 790 66.1 L 800 66.3 L 810 66.4 L 820 66.2 L 830 66.1 L 840 66.1 L 850 66.0 L 860 65.9 L 870 65.8 L 880 65.9 L 890 66.0 L 900 66.0 L 910 66.2 L 920 66.2 L 930 66.0 L 940 66.1 L 950 66.3 L 960 66.4 L 970 66.6 L 980 66.5 L 990 66.5 L 1000 66.6 L 1010 66.7 L 1020 66.6 L 1030 66.6 L 1040 66.7 L 1050 66.9 L 1060 67.0 L 1070 67.1 L 1080 67.1 L 1090 67.2 L 1100 67.4 L 1110 67.4 L 1120 67.5 L 1130 67.3 L 1140 67.4 L 1150 67.4 L 1160 67.3 L 1170 67.4 L 1180 67.2 L 1190 67.2 L 1200 67.3" />
      <g className="ticks">
      <text x="14" y="139">04</text>
      <text x="184" y="139">08</text>
      <text x="354" y="139">12</text>
      <text x="524" y="139">16</text>
      <text x="694" y="139">20</text>
      <text x="864" y="139">24</text>
      <text x="1034" y="139">28</text>
      <text x="1186" y="139">01</text>
      </g>
    </svg>
  );
}

/** The volume histogram, behind the closing section. */
export function VolumeArt() {
  return (
    <svg className="art art-vol" viewBox="0 0 1200 148" aria-hidden="true" focusable="false">
      <g className="bars">
      <rect x="0.0" y="113.8" width="31.4" height="6.2" rx="1" />
      <rect x="35.4" y="114.1" width="31.4" height="5.9" rx="1" />
      <rect x="70.8" y="113.7" width="31.4" height="6.3" rx="1" />
      <rect x="106.2" y="109.3" width="31.4" height="10.7" rx="1" />
      <rect x="141.6" y="104.8" width="31.4" height="15.2" rx="1" />
      <rect x="177.1" y="101.9" width="31.4" height="18.1" rx="1" />
      <rect x="212.5" y="99.0" width="31.4" height="21.0" rx="1" />
      <rect x="247.9" y="103.5" width="31.4" height="16.5" rx="1" />
      <rect x="283.3" y="101.6" width="31.4" height="18.4" rx="1" />
      <rect x="318.7" y="103.8" width="31.4" height="16.2" rx="1" />
      <rect x="354.1" y="99.3" width="31.4" height="20.7" rx="1" />
      <rect x="389.5" y="101.9" width="31.4" height="18.1" rx="1" />
      <rect x="424.9" y="109.1" width="31.4" height="10.9" rx="1" />
      <rect x="460.4" y="103.5" width="31.4" height="16.5" rx="1" />
      <rect x="495.8" y="105.2" width="31.4" height="14.8" rx="1" />
      <rect x="531.2" y="108.6" width="31.4" height="11.4" rx="1" />
      <rect x="566.6" y="109.0" width="31.4" height="11.0" rx="1" />
      <rect x="602.0" y="112.1" width="31.4" height="7.9" rx="1" />
      <rect x="637.4" y="111.9" width="31.4" height="8.1" rx="1" />
      <rect x="672.8" y="58.0" width="31.4" height="62.0" rx="1" />
      <rect x="708.2" y="58.0" width="31.4" height="62.0" rx="1" />
      <rect x="743.6" y="24.0" width="31.4" height="96.0" rx="1" />
      <rect x="779.1" y="74.0" width="31.4" height="46.0" rx="1" />
      <rect x="814.5" y="78.0" width="31.4" height="42.0" rx="1" />
      <rect x="849.9" y="82.0" width="31.4" height="38.0" rx="1" />
      <rect x="885.3" y="101.3" width="31.4" height="18.7" rx="1" />
      <rect x="920.7" y="86.0" width="31.4" height="34.0" rx="1" />
      <rect x="956.1" y="86.0" width="31.4" height="34.0" rx="1" />
      <rect x="991.5" y="104.9" width="31.4" height="15.1" rx="1" />
      <rect x="1026.9" y="99.4" width="31.4" height="20.6" rx="1" />
      <rect x="1062.4" y="103.2" width="31.4" height="16.8" rx="1" />
      <rect x="1097.8" y="96.0" width="31.4" height="24.0" rx="1" />
      <rect x="1133.2" y="98.9" width="31.4" height="21.1" rx="1" />
      <rect x="1168.6" y="103.7" width="31.4" height="16.3" rx="1" />
      </g>
      <g className="ticks">
      <text x="14" y="139">04</text>
      <text x="184" y="139">08</text>
      <text x="354" y="139">12</text>
      <text x="524" y="139">16</text>
      <text x="694" y="139">20</text>
      <text x="864" y="139">24</text>
      <text x="1034" y="139">28</text>
      <text x="1186" y="139">01</text>
      </g>
    </svg>
  );
}
