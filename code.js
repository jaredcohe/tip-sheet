// Main runner for Tips Sheet, on click button
function createTipsSheet() {

    // Authorization
        var properties = PropertiesService.getScriptProperties();
        var squareAccessToken = properties.getProperty('square_access_token');
        var fullAccessToken = 'Bearer ' + squareAccessToken;

    // Foundational data
        var sheetObject = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Automated Tips Sheet");
        var locationId = sheetObject.getRange(9, 2, 1, 1).getValues()[0][0];
        var [startDate, endDate] = getDatesForTipsSheet(sheetObject);

    // Tip amounts
        // Get total tip amounts from manual entry into the sheet and pull credit card tips from Square
            var orders = getAndCombineOrdersData(startDate, endDate, locationId, fullAccessToken);
            var totalTips = 0;
            orders.forEach(function (order) {
                totalTips = totalTips + order["total_tip_money"]["amount"];
            });

        // Clear and write total credit card tips
            sheetObject.getRange(2, 2, 1, 1).clearContent().setValue(totalTips / 100);

    // Get shifts with hours from square
        var shifts = getShiftsFromSquare(startDate, endDate, locationId, fullAccessToken);

    // Get all team members list from Square
        var employees = getAllEmployeeDataFromSquare(fullAccessToken);

    // Create the rows of data, including combining team member data with shifts data by looping through team based on team_member_id
        var listOfTipSheetEntries = [];
        var tipPoolRulesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tip Pool Rules");    
        var sheetObjectLastRow = tipPoolRulesSheet.getLastRow();
        var listOfTippedRolesArrayOfArrays = tipPoolRulesSheet.getRange(7, 1, sheetObjectLastRow-6, 1).getValues();
        var listOfTippedRolesArray = [];
        var employeeFirstName;
        var employeeLastName;

        // Get list of tipped roles to compare to the shifts
            listOfTippedRolesArrayOfArrays.forEach(function (role) {
                listOfTippedRolesArray.push(role[0].toLowerCase());
            });

        // Loop through shifts, and if it's a tipped role based on title matching a tipped role title, then put it in the list listOfTipSheetEntries
        var shiftTitle;
        var shiftTitleLowerCase;
        shifts.forEach(function (shift) {

            // Loop through employees and add first and last name if the employee ID matches, optimize this later to be cheaper
            employees.forEach(function (employee) {
                if (shift["employee_id"] == employee["id"]) {
                    employeeFirstName = employee["given_name"];
                    employeeLastName = employee["family_name"];
                }
            });

            shiftTitle = shift["wage"]["title"]
            shiftTitleLowerCase = shift["wage"]["title"].toLowerCase()

            // If the shift title is in the list of titles for tipped roles then add it and all the other data
            // to the list of tip sheet entries
            if (listOfTippedRolesArray.includes(shiftTitleLowerCase)) {

                // Loop through employees and add first and last name if the employee ID matches, optimize this later to be cheaper
                    employees.forEach(function (employee) {
                        if (shift["employee_id"] == employee["id"]) {
                            employeeFirstName = employee["given_name"];
                            employeeLastName = employee["family_name"];
                        }
                    });

                listOfTipSheetEntries.push([employeeLastName, employeeFirstName, shiftTitle, (Math.round(((Date.parse(shift["end_at"]) - Date.parse(shift["start_at"])) / 36e5) * 100)) / 100]);
            };
        });

    // Clear and write the rows of data
    sheetObject.getRange(12, 1, 30, 4).clearContent();
    sheetObject.getRange(12, 1, listOfTipSheetEntries.length, 4).setValues(listOfTipSheetEntries);
};

// Based on the date in the sheet, calculate the start and end times and convert them to RFC 3339 date format in UTC timezone
function getDatesForTipsSheet(sheetObject) {
    var date = sheetObject.getRange(1, 2).getValues()[0][0];
    var dayAfter = date.getDate() + 1;
    var nowFormatted = date.toISOString(); //RFC 3339 format
    var startDate = nowFormatted.replace(/\d+:\d+:\d+/, "09:00:00");
    var dayTwoDigit = dayAfter > 10 ? dayAfter + "T" : "0" + dayAfter.toString() + "T";
    var endDate = startDate.replace(/\d{2}T/, dayTwoDigit);
    return [startDate, endDate];
};

// Get employee data from Square for everyone
function getAllEmployeeDataFromSquare(fullAccessToken) {
    var data = {
        "limit" : 200
    }

    var options = {
      'method' : 'post',
      'contentType': 'application/json',
      'headers' : { 'Square-Version' : '2022-10-19', 'Authorization' : fullAccessToken },
      'payload' : JSON.stringify(data)
    };

    var response = UrlFetchApp.fetch('https://connect.squareup.com/v2/team-members/search', options);
    return JSON.parse(response.getContentText())["team_members"];
};

// Get shifts from square for the relevant day (24 hour period) and location
function getShiftsFromSquare(startDate, endDate, locationId, fullAccessToken) {
    var data = {
      "query" : {
          "filter": {
              "location_ids": [
                locationId
              ],
              "start": {
                  "start_at": startDate,
                  "end_at": endDate
              }
          }
      },
      "limit": 200
    }

    var options = {
      'method' : 'post',
      'contentType': 'application/json',
      'headers' : { 'Square-Version' : '2022-10-19', 'Authorization' : fullAccessToken },
      'payload' : JSON.stringify(data)
    };

    var response = UrlFetchApp.fetch('https://connect.squareup.com/v2/labor/shifts/search', options);
    return JSON.parse(response.getContentText())["shifts"];
};

function getOrdersFromDay(startDate, endDate, locationId, cursor, fullAccessToken) {
    var data = {
      "query" : {
          "filter": {
              "date_time_filter": {
                  "created_at": {
                    "start_at": startDate,
                    "end_at": endDate
                  }
              },
              "state_filter": {
                "states": [
                  "COMPLETED", "CANCELED"
                ]
              }
          },
          "sort": {
            "sort_field": "CREATED_AT",
            "sort_order": "DESC"
          }
      },
      "location_ids": [
          locationId
      ],
      "limit": 500,
      "cursor" : cursor
    }

    var options = {
      'method' : 'post',
      'contentType': 'application/json',
      'headers' : { 'Square-Version' : '2022-10-19', 'Authorization' : fullAccessToken },
      'payload' : JSON.stringify(data)
    };

    var response = UrlFetchApp.fetch('https://connect.squareup.com/v2/orders/search', options);
    return JSON.parse(response);
};

// Get orders by calling Square API function (getOrdersFromDay) as many times as necessary for all the pages
function getAndCombineOrdersData(startDate, endDate, locationId, fullAccessToken) {
    var orders = [];
    var response = getOrdersFromDay(startDate, endDate, locationId, '', fullAccessToken);
    var newOrders = response["orders"];
    var cursor = response["cursor"];
    orders = orders.concat(newOrders);

    while (cursor) {
        response = getOrdersFromDay(startDate, endDate, locationId, cursor, fullAccessToken);
        newOrders = response["orders"];
        cursor = response["cursor"];
        orders = orders.concat(newOrders);
    };

    return orders;
};
