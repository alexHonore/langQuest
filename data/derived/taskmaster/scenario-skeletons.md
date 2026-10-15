# Taskmaster-1 scenario skeletons (structure only)

Generated 2026-10-15T01:42:00Z from 13202 dialogues (snapshot d92cb6af3005f1dc09c39e75e7daf4a04905e00b). Dialogue structure patterns derived from Taskmaster-1 (Byrne et al., 2019), Google LLC, CC BY 4.0.

## coffee-ordering → cafe_order_drink (cafe)

- sample: 2140 dialogues; turns min 2 / p50 21 / mean 21.5 / p90 27 / max 96
- required slots: location.store, name.drink, size.drink; optional: num.drink, type.milk, preference
- rates: revision 15.4% · unavailable 21.3% · clarification 33.7% · user questions 9.9% of user turns
- intents: greet_hello, request_drink, offer_options, choose_option, specify_quantity, confirm_order, state_price, pay, thank
- top slot orders:
  - location.store → name.drink → size.drink → type.milk → preference (233)
  - name.drink → size.drink → type.milk → preference → location.store (90)
  - location.store → size.drink → name.drink → type.milk → preference (82)
  - location.store → name.drink → size.drink → preference → type.milk (73)
  - name.drink → location.store → size.drink → type.milk → preference (58)
- top act sequences:
  - user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask (6)
  - user.ask > assistant.ask > user.say > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask (6)
  - user.say > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask (5)
  - user.ask > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.say > assistant.ask (4)
  - user.say > assistant.ask > user.provide_slot > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask (4)
- brief:
  - Write 11–14 exchanges; real coffee ordering dialogues run 21 turns at the median.
  - Fill slots in a natural order (most common: location.store → name.drink → size.drink → type.milk → preference); the staff character asks for missing ones.
  - 21.3% of dialogues hit something unavailable → the character must offer an alternative, the learner must choose or decline.
  - 15.4% contain a learner revision ("actually…"); include at least one twist where the learner changes a slot.
  - 33.7% contain a clarification question after an offer; keep the character's offers short enough to answer.
  - LangQuest blueprint cafe_order_drink: objectives greet, request_drink, choose_option, pay, thank; learner role "customer at a café", character role "café server".
  - Do not translate Taskmaster turns. Generate or commission native-language turns from this structure and have a native reviewer judge naturalness (§9.3).

## restaurant-table → restaurant_order_meal (restaurant)

- sample: 2331 dialogues; turns min 0 / p50 22 / mean 24.4 / p90 32 / max 148
- required slots: name.restaurant, name.reservation, num.guests, time.reservation; optional: type.seating, location.restaurant
- rates: revision 13.7% · unavailable 44.3% · clarification 66.1% · user questions 21.1% of user turns
- intents: greet_hello, make_reservation, request_table, ask_availability, make_plan_time, suggest_other_time, confirm_plan, thank
- top slot orders:
  - location.restaurant → name.restaurant (233)
  - location.restaurant → name.restaurant → time.reservation → num.guests (107)
  - location.restaurant → name.restaurant → time.reservation → num.guests → type.seating (104)
  - name.restaurant → time.reservation → num.guests → type.seating (88)
  - location.restaurant → type.seating → name.restaurant → time.reservation → num.guests (80)
- top act sequences:
  - assistant.greet > user.accept > assistant.ask > user.say > assistant.ask > user.say > assistant.say > assistant.offer > assistant.ask > user.ask > assistant.offer > user.ask (5)
  - user.say > assistant.say > user.say > assistant.say > user.say > assistant.say > user.say > assistant.say > user.say > assistant.say > user.say > assistant.say (4)
  - assistant.greet > user.accept > assistant.ask > user.say > assistant.ask > user.say > assistant.say > assistant.offer > user.ask > assistant.say > user.ask > assistant.say (4)
  - assistant.greet > user.accept > assistant.ask > user.say > assistant.ask > user.say > assistant.say > assistant.ask > user.ask > assistant.offer > user.ask > assistant.say (3)
  - assistant.greet (3)
- brief:
  - Write 11–16 exchanges; real restaurant table dialogues run 22 turns at the median.
  - Fill slots in a natural order (most common: location.restaurant → name.restaurant); the staff character asks for missing ones.
  - 44.3% of dialogues hit something unavailable → the character must offer an alternative, the learner must choose or decline.
  - 13.7% contain a learner revision ("actually…"); include at least one twist where the learner changes a slot.
  - 66.1% contain a clarification question after an offer; keep the character's offers short enough to answer.
  - LangQuest blueprint restaurant_order_meal: objectives table, recommend, order, ingredients, bill; learner role "diner", character role "waiter".
  - Do not translate Taskmaster turns. Generate or commission native-language turns from this structure and have a native reviewer judge naturalness (§9.3).

## pizza-ordering → restaurant_order_meal (restaurant)

- sample: 2438 dialogues; turns min 1 / p50 21 / mean 21.2 / p90 28 / max 144
- required slots: name.store, name.pizza, size.pizza; optional: type.topping, type.crust, preference, location.store
- rates: revision 20% · unavailable 26.1% · clarification 34.7% · user questions 10.5% of user turns
- intents: request_food, choose_option, specify_quantity, ask_price, ask_ingredients, confirm_order, say_unavailable, ask_alternative
- top slot orders:
  - name.store → size.pizza → name.pizza → type.crust (66)
  - name.store → location.store → size.pizza → name.pizza → type.topping (54)
  - name.store → size.pizza → type.topping → type.crust (54)
  - name.store → size.pizza → name.pizza → type.topping → preference (42)
  - name.store → size.pizza → name.pizza → type.topping → type.crust (41)
- top act sequences:
  - user.say > assistant.ask > user.accept > assistant.ask > user.accept > assistant.say > user.say > assistant.ask > user.say > assistant.ask > user.ack > assistant.say (3)
  - assistant.greet (3)
  - user.ask > assistant.say > user.provide_slot > assistant.say > user.ack > assistant.ask > user.say > assistant.ask > user.reject > assistant.ask > user.accept > assistant.say (2)
  - user.request > assistant.unavailable > user.revise > assistant.offer > user.accept > assistant.offer > user.revise > assistant.say > user.revise > assistant.say > user.say > assistant.ask (2)
  - user.ask > assistant.say > user.accept > assistant.ask > user.ask > assistant.ask > user.say > assistant.ask > user.accept > assistant.ask > user.say > assistant.say (2)
- brief:
  - Write 11–14 exchanges; real pizza ordering dialogues run 21 turns at the median.
  - Fill slots in a natural order (most common: name.store → size.pizza → name.pizza → type.crust); the staff character asks for missing ones.
  - 26.1% of dialogues hit something unavailable → the character must offer an alternative, the learner must choose or decline.
  - 20% contain a learner revision ("actually…"); include at least one twist where the learner changes a slot.
  - 34.7% contain a clarification question after an offer; keep the character's offers short enough to answer.
  - LangQuest blueprint restaurant_order_meal: objectives table, recommend, order, ingredients, bill; learner role "diner", character role "waiter".
  - Do not translate Taskmaster turns. Generate or commission native-language turns from this structure and have a native reviewer judge naturalness (§9.3).

## uber-lyft → take_taxi (transport)

- sample: 2097 dialogues; turns min 0 / p50 20 / mean 21.8 / p90 29 / max 108
- required slots: location.from, location.to, type.ride, num.people; optional: price.estimate, duration.estimate, time.pickup, time.dropoff
- rates: revision 13% · unavailable 21.6% · clarification 53.5% · user questions 14.7% of user turns
- intents: hail_taxi, state_destination, ask_fare, ask_is_it_far, make_plan_time, confirm_plan, thank
- top slot orders:
  - location.from → location.to → num.people → type.ride → price.estimate (348)
  - location.from → location.to → type.ride → price.estimate → time.pickup (141)
  - location.to → location.from → num.people → type.ride → price.estimate (112)
  - location.from → location.to → type.ride → num.people → price.estimate (81)
  - location.from → location.to → num.people → type.ride → time.pickup (69)
- top act sequences:
  - assistant.greet (4)
  - user.say > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.ask > assistant.offer > user.ask > assistant.offer > user.ask > assistant.offer (3)
  - user.greet > assistant.ask > user.accept > assistant.ask > user.provide_slot > assistant.ask > user.request > assistant.ask > user.accept > assistant.offer > user.say > assistant.say (3)
  - user.greet > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.say > assistant.ask > user.accept > assistant.offer > user.say > assistant.ask (2)
  - user.greet > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.provide_slot > assistant.ask > user.ask > assistant.offer > user.ask > assistant.offer (2)
- brief:
  - Write 10–15 exchanges; real uber lyft dialogues run 20 turns at the median.
  - Fill slots in a natural order (most common: location.from → location.to → num.people → type.ride → price.estimate); the staff character asks for missing ones.
  - 21.6% of dialogues hit something unavailable → the character must offer an alternative, the learner must choose or decline.
  - 13% contain a learner revision ("actually…"); include at least one twist where the learner changes a slot.
  - 53.5% contain a clarification question after an offer; keep the character's offers short enough to answer.
  - LangQuest blueprint take_taxi: objectives hail, destination, fare, stop, pay; learner role "passenger", character role "taxi driver".
  - Do not translate Taskmaster turns. Generate or commission native-language turns from this structure and have a native reviewer judge naturalness (§9.3).

## movie-tickets → buy_train_ticket (travel)

- sample: 2283 dialogues; turns min 0 / p50 22 / mean 23.5 / p90 30 / max 88
- required slots: name.movie, name.theater, num.tickets, time.start, location.theater, price.ticket; optional: type.screening, time.end, time.duration
- rates: revision 9.2% · unavailable 44.3% · clarification 51.6% · user questions 13.3% of user turns
- intents: buy_ticket, specify_quantity, ask_time, tell_time, choose_option, ask_price, confirm_order, say_unavailable
- top slot orders:
  - name.movie → location.theater → name.theater → time.start → num.tickets (261)
  - name.movie → location.theater → time.start → name.theater → num.tickets (98)
  - name.movie → location.theater → name.theater → num.tickets → time.start (92)
  - num.tickets → name.movie → location.theater → name.theater → time.start (88)
  - name.movie → location.theater → num.tickets → name.theater → time.start (83)
- top act sequences:
  - user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.say > assistant.ask (4)
  - user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask (3)
  - assistant.greet (3)
  - user.request > assistant.ask > user.accept > assistant.offer > user.say > assistant.ask > user.provide_slot > assistant.ask > user.say > assistant.offer > user.provide_slot > assistant.ask (2)
  - user.accept > assistant.ask > user.accept > assistant.ask > user.say > assistant.ask > user.accept > assistant.ask > user.accept > assistant.ask > user.say > assistant.ask (2)
- brief:
  - Write 11–15 exchanges; real movie tickets dialogues run 22 turns at the median.
  - Fill slots in a natural order (most common: name.movie → location.theater → name.theater → time.start → num.tickets); the staff character asks for missing ones.
  - 44.3% of dialogues hit something unavailable → the character must offer an alternative, the learner must choose or decline.
  - 9.2% contain a learner revision ("actually…"); include at least one twist where the learner changes a slot.
  - 51.6% contain a clarification question after an offer; keep the character's offers short enough to answer.
  - LangQuest blueprint buy_train_ticket: objectives ticket, time, quantity, stop, pay; learner role "traveller at a ticket counter", character role "ticket clerk".
  - Do not translate Taskmaster turns. Generate or commission native-language turns from this structure and have a native reviewer judge naturalness (§9.3).

## auto-repair-appt → no blueprint (daily_life)

- sample: 1859 dialogues; turns min 1 / p50 23 / mean 25.6 / p90 36 / max 116
- required slots: name.store, name.customer, date.appt, time.appt; optional: reason.appt, name.vehicle, year.vehicle, location.store
- rates: revision 9.8% · unavailable 24.3% · clarification 37.1% · user questions 7.4% of user turns
- intents: report_broken, make_reservation, ask_availability, make_plan_time, suggest_other_time, confirm_plan, ask_price
- top slot orders:
  - name.store → name.customer → year.vehicle → name.vehicle → reason.appt (232)
  - name.store → name.customer → reason.appt → year.vehicle → name.vehicle (94)
  - name.store → year.vehicle → name.vehicle → name.customer → reason.appt (80)
  - name.store → year.vehicle → name.vehicle → reason.appt → date.appt (47)
  - name.store → reason.appt → year.vehicle → name.vehicle → date.appt (40)
- top act sequences:
  - assistant.greet > user.accept > assistant.ask > user.provide_slot > assistant.ask > user.provide_slot > assistant.ask > user.say > assistant.ask > user.say > assistant.ask > user.provide_slot (14)
  - assistant.greet > user.accept > assistant.ask > user.provide_slot > assistant.ask > user.provide_slot > assistant.ask > user.say > assistant.ask > user.ack > assistant.ask > user.provide_slot (12)
  - assistant.greet > user.accept > assistant.ask > user.provide_slot > assistant.ask > user.provide_slot > assistant.ask > user.say > assistant.say > assistant.ask > user.say > assistant.ask (11)
  - assistant.greet > user.accept > assistant.ask > user.provide_slot > assistant.ask > user.provide_slot > assistant.ask > user.say > assistant.say > assistant.ask > user.ack > assistant.ask (8)
  - assistant.greet > user.accept > assistant.ask > user.provide_slot > assistant.ask > user.say > assistant.ask > user.say > assistant.ask > user.provide_slot > assistant.ask > user.provide_slot (7)
- brief:
  - Write 12–18 exchanges; real auto repair appt dialogues run 23 turns at the median.
  - Fill slots in a natural order (most common: name.store → name.customer → year.vehicle → name.vehicle → reason.appt); the staff character asks for missing ones.
  - 24.3% of dialogues hit something unavailable → the character must offer an alternative, the learner must choose or decline.
  - 9.8% contain a learner revision ("actually…"); include at least one twist where the learner changes a slot.
  - 37.1% contain a clarification question after an offer; keep the character's offers short enough to answer.
  - No chapter-1 blueprint mapped; use as a chapter-3 scenario brief.
  - Do not translate Taskmaster turns. Generate or commission native-language turns from this structure and have a native reviewer judge naturalness (§9.3).
